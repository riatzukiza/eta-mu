(ns eta-mu.extensions.receipt-river-test
  "Red phase tests for receipt-river EDN refactor.

  All tests in this ns are expected to FAIL until the following
  pure-function modules are extracted from receipt_river.cljs:

    eta-mu.extensions.receipt-river.edn
      - edn-event       :: map -> edn string
      - parse-edn-event :: string -> map (nil on parse failure)

    eta-mu.extensions.receipt-river.repo
      - find-git-root         :: (join-fn, dirname-fn, exists-fn) -> path -> string|nil
      - touched-repos         :: (find-git-root-fn) -> tool-calls -> {repo-root -> call-count}
      - should-activate?      :: repo-state -> boolean
      - contract-violations   :: touched-repos -> receipts-by-repo -> [repo-root]

  None of these namespaces exist yet. The shadow-cljs node-test
  build will fail to compile until they are created (red phase).
  Create stub namespaces returning nil/empty to enter green phase,
  then implement to pass."
  (:require [cljs.test :refer [deftest is testing]]
            ["node:child_process" :as child-process]
            ["node:fs" :as fs]
            ["node:os" :as os]
            ["node:path" :as path]
            [eta-mu.extensions.receipt-river :as receipt-river]
            [eta-mu.extensions.receipt-river.edn  :as rr-edn]
            [eta-mu.extensions.receipt-river.repo :as rr-repo]))

;; ============================================================
;; EDN event format
;; ============================================================

(def sample-event
  {:ts      "2026-04-19T05:00:00.000Z"
   :kind    :observation
   :repo    "/home/user/projects/eta-mu"
   :origin  "pi"
   :owner   "receipt-river"
   :dod     "receipt-river"
   :pi      "0.63.1"
   :host    "local"
   :manifest "none"
   :refs    "none"})

(deftest edn-event-produces-valid-edn
  (testing "round-trips through parse-edn-event"
    (let [line (rr-edn/edn-event sample-event)
          back (rr-edn/parse-edn-event line)]
      (is (string? line))
      (is (map? back))
      (is (= (:kind sample-event) (:kind back)))
      (is (= (:repo sample-event) (:repo back)))
      (is (= (:ts sample-event)   (:ts back))))))

(deftest edn-event-is-single-line
  (testing "no embedded newlines — safe to append"
    (let [line (rr-edn/edn-event sample-event)]
      (is (not (.includes line "\n"))))))

(deftest edn-event-contains-required-keys
  (testing "serialized form contains all required keys"
    (let [line (rr-edn/edn-event sample-event)]
      (doseq [k [:ts :kind :repo :origin :owner :dod :pi :host :manifest :refs]]
        (is (.includes line (name k)))))))

(deftest edn-event-kind-is-keyword
  (testing "kind round-trips as keyword"
    (let [back (rr-edn/parse-edn-event (rr-edn/edn-event sample-event))]
      (is (keyword? (:kind back))))))

(deftest parse-edn-event-returns-nil-on-garbage
  (is (nil? (rr-edn/parse-edn-event "not edn at all {{{"  )))
  (is (nil? (rr-edn/parse-edn-event "")))
  (is (nil? (rr-edn/parse-edn-event nil))))

(deftest parse-edn-event-returns-nil-on-non-map
  (testing "vectors and scalars are rejected"
    (is (nil? (rr-edn/parse-edn-event "[1 2 3]")))
    (is (nil? (rr-edn/parse-edn-event "42")))))

(deftest edn-event-optional-keys-omitted-when-nil
  (testing "note/tests/decisions/drift absent when not supplied"
    (let [line (rr-edn/edn-event sample-event)]
      (is (not (.includes line ":note")))
      (is (not (.includes line ":tests")))
      (is (not (.includes line ":decisions")))
      (is (not (.includes line ":drift"))))))

(deftest edn-event-optional-keys-present-when-supplied
  (let [e    (assoc sample-event :note "fixed the thing" :tests "42 pass 0 fail")
        back (rr-edn/parse-edn-event (rr-edn/edn-event e))]
    (is (= "fixed the thing" (:note back)))
    (is (= "42 pass 0 fail" (:tests back)))))

(deftest versioned-envelope-remains-readable-by-active-extension
  (let [envelope {:event/id #uuid "00000000-0000-0000-0000-000000000001"
                  :event/type :receipt-river/receipt-recorded
                  :event/recorded-at #inst "2026-07-29T00:00:00.000Z"
                  :event/schema {:id :eta-mu.receipt-river/receipt-recorded
                                 :version 1}
                  :event/producer {:eta-mu/version "1.1.1"
                                   :package/name "@eta-mu/receipt-river"
                                   :package/version "0.1.0"}
                  :event/subject {:repository/path "/repo"}
                  :event/payload sample-event}
        result (receipt-river/validate-edn-event (pr-str envelope) 1)]
    (is (true? (aget result "ok")))
    (is (= envelope (aget result "event")))))

;; ============================================================
;; Git repo root detection
;; ============================================================

(defn make-fs
  "Builds a fake filesystem predicate from a set of existing paths."
  [existing]
  (fn [p] (contains? existing p)))

(defn make-join []
  (fn [a b] (str a "/" b)))

(defn make-dirname []
  (fn [p]
    (let [idx (.lastIndexOf p "/")]
      (if (pos? idx) (subs p 0 idx) nil))))

(deftest find-git-root-direct
  (testing "finds .git at the given dir"
    (let [exists? (make-fs #{"/repo/.git"})
          join    (make-join)
          dirname (make-dirname)
          result  (rr-repo/find-git-root join dirname exists? "/repo/src/core")]
      (is (= "/repo" result)))))

(deftest find-git-root-walks-up
  (testing "walks up to find .git"
    (let [exists? (make-fs #{"/mono/.git"})
          join    (make-join)
          dirname (make-dirname)
          result  (rr-repo/find-git-root join dirname exists? "/mono/packages/eta-mu/src")]
      (is (= "/mono" result)))))

(deftest find-git-root-submodule
  (testing "stops at the nearest .git (submodule wins over monorepo root)"
    (let [exists? (make-fs #{"/mono/.git" "/mono/packages/eta-mu/.git"})
          join    (make-join)
          dirname (make-dirname)
          result  (rr-repo/find-git-root join dirname exists? "/mono/packages/eta-mu/src")]
      (is (= "/mono/packages/eta-mu" result)))))

(deftest find-git-root-returns-nil-when-not-found
  (let [exists? (make-fs #{})
        join    (make-join)
        dirname (make-dirname)
        result  (rr-repo/find-git-root join dirname exists? "/tmp/no-git")]
    (is (nil? result))))

(deftest find-git-root-nil-path
  (let [exists? (make-fs #{})
        join    (make-join)
        dirname (make-dirname)]
    (is (nil? (rr-repo/find-git-root join dirname exists? nil)))))

;; ============================================================
;; Touched-repos reduction
;; ============================================================

(def fake-find-git-root
  "Resolves /mono/packages/X/** -> /mono/packages/X,
   /mono/shared/** -> /mono, everything else nil."
  (fn [path]
    (cond
      (and path (.startsWith path "/mono/packages/alpha")) "/mono/packages/alpha"
      (and path (.startsWith path "/mono/packages/beta"))  "/mono/packages/beta"
      (and path (.startsWith path "/mono/shared"))         "/mono"
      :else nil)))

(def tool-calls-mixed
  [{:tool/name "read_file"   :tool/params {:path "/mono/packages/alpha/src/core.cljs"}}
   {:tool/name "write_file"  :tool/params {:path "/mono/packages/alpha/src/core.cljs"}}
   {:tool/name "read_file"   :tool/params {:path "/mono/packages/beta/README.md"}}
   {:tool/name "read_file"   :tool/params {:path "/mono/packages/beta/src/main.cljs"}}
   {:tool/name "bash"        :tool/params {:command "echo hi"}}])

(deftest touched-repos-counts-calls-per-repo
  (let [result (rr-repo/touched-repos fake-find-git-root tool-calls-mixed)]
    (is (= 2 (get result "/mono/packages/alpha")))
    (is (= 2 (get result "/mono/packages/beta")))))

(deftest touched-repos-ignores-pathless-tools
  (testing "bash with no path param is not counted"
    (let [result (rr-repo/touched-repos fake-find-git-root tool-calls-mixed)]
      (is (not (contains? result nil))))))

(deftest touched-repos-empty
  (is (= {} (rr-repo/touched-repos fake-find-git-root []))))

(deftest touched-repos-all-outside-git
  (let [calls  [{:tool/name "read_file" :tool/params {:path "/tmp/scratch.txt"}}]
        result (rr-repo/touched-repos fake-find-git-root calls)]
    (is (= {} result))))

;; ============================================================
;; Ledger activation threshold
;; ============================================================

(deftest should-activate-below-threshold
  (testing "fewer than threshold calls -> inactive"
    (is (false? (rr-repo/should-activate? {:call-count 2 :threshold 3 :active? false})))))

(deftest should-activate-at-threshold
  (testing "at threshold -> activate"
    (is (true? (rr-repo/should-activate? {:call-count 3 :threshold 3 :active? false})))))

(deftest should-activate-already-active
  (testing "already active -> stays active regardless of count"
    (is (true? (rr-repo/should-activate? {:call-count 0 :threshold 3 :active? true})))))

(deftest should-activate-default-threshold
  (testing "threshold defaults to 3 when absent"
    (is (false? (rr-repo/should-activate? {:call-count 2 :active? false})))
    (is (true?  (rr-repo/should-activate? {:call-count 3 :active? false})))))

;; ============================================================
;; Contract violation detection
;; ============================================================

(deftest contract-violations-all-covered
  (testing "no violations when every touched repo has a receipt this turn"
    (let [touched  {"/mono/packages/alpha" 3 "/mono/packages/beta" 1}
          receipts #{"/mono/packages/alpha" "/mono/packages/beta"}
          result   (rr-repo/contract-violations touched receipts)]
      (is (empty? result)))))

(deftest contract-violations-missing-receipt
  (testing "reports repos touched but without a receipt"
    (let [touched  {"/mono/packages/alpha" 3 "/mono/packages/beta" 2}
          receipts #{"/mono/packages/alpha"}
          result   (rr-repo/contract-violations touched receipts)]
      (is (= 1 (count result)))
      (is (= "/mono/packages/beta" (first result))))))

(deftest contract-violations-nothing-touched
  (is (empty? (rr-repo/contract-violations {} #{}))))

(deftest contract-violations-read-only-repo-exempt
  (testing "repos with only 1 call (read-only recon) are exempt"
    (let [touched  {"/mono/packages/alpha" 1 "/mono/packages/beta" 4}
          receipts #{}
          result   (rr-repo/contract-violations touched receipts)]
      (is (= 1 (count result)))
      (is (= "/mono/packages/beta" (first result))))))

(deftest contract-violations-returns-sorted
  (testing "violation list is deterministically ordered"
    (let [touched  {"/b" 5 "/a" 5 "/c" 5}
          receipts #{}
          result   (rr-repo/contract-violations touched receipts)]
      (is (= (sort result) result)))))

;; ============================================================
;; Actual compiled validation command/tool attribution
;; ============================================================

(defn with-validation-directory [git? run]
  (let [root (.mkdtempSync fs (path/join (.tmpdir os) "receipt-validation-"))
        nested (path/join root "nested")]
    (try
      (.mkdirSync fs nested)
      (when git?
        (.execFileSync child-process "git" #js ["init" "--quiet" root]))
      (run root nested)
      (finally
        (.rmSync fs root #js {:recursive true :force true})))))

(defn isolated-validation-routes
  ([cwd file] (isolated-validation-routes cwd file []))
  ([cwd file active-repos]
   (let [state #js {:enabled true :currentTurn 0 :activeLedgerRepos (clj->js active-repos)}
         ctx #js {:cwd cwd :hasUI false}]
     ;; Isolate host state/event publication; use real root resolution,
     ;; filesystem reads, validation, command dispatch and tool dispatch.
     (with-redefs [receipt-river/get-state (fn [] state)
                   receipt-river/log-event (fn [_ctx _state _action _extra] nil)]
       (receipt-river/handle-receipt-river-command "validate 200" ctx)
       (let [command (aget state "lastValidation")
             tool (receipt-river/execute-receipt-river-tool
                   "receipt-validation-test" #js {:action "validate" :path file}
                   nil nil ctx)]
         [command (aget tool "details")])))))

(defn assert-validation-result-shape [result file line]
  (is (= file (aget result "file")))
  (is (= 1 (aget result "count")))
  (is (js/Array.isArray (aget result "failures")))
  (is (js/Array.isArray (aget (aget result "last") "errors")))
  (is (= line (aget (aget result "last") "line")))
  (is (= 0 (aget (aget result "last") "lineNumber"))))

(deftest compiled-command-and-tool-use-real-containing-git-root
  (with-validation-directory
    true
    (fn [root nested]
      (let [file (path/join root "receipts.edn")
            line (pr-str (dissoc sample-event :repo))
            before-global (aget js/globalThis receipt-river/GLOBAL-KEY)]
        (.writeFileSync fs file (str line "\n") #js {:mode 384})
        (let [before (.readFileSync fs file)]
          (is (= root (receipt-river/find-git-root nested)))
          (doseq [[route result] (map vector [:command :tool]
                                    (isolated-validation-routes nested file))]
            (testing (name route)
              ;; Causal RED on b149eb26: both routes demanded a row-level :repo.
              (is (true? (aget result "ok"))
                  "A valid repo-less row must use its actual containing Git root")
              (assert-validation-result-shape result file line)))
          (is (.equals before (.readFileSync fs file)))
          (is (identical? before-global
                          (aget js/globalThis receipt-river/GLOBAL-KEY))))))))

(deftest compiled-command-and-tool-refuse-cwd-as-repository-context
  (with-validation-directory
    false
    (fn [root _nested]
      (let [file (path/join root "receipts.edn")
            line (pr-str (dissoc sample-event :repo))]
        (.writeFileSync fs file (str line "\n") #js {:mode 384})
        (let [before (.readFileSync fs file)]
          (is (nil? (receipt-river/find-git-root root)))
          (doseq [result (isolated-validation-routes root file)]
            (is (false? (aget result "ok")))
            (is (= 1 (.-length (aget result "failures"))))
            (assert-validation-result-shape result file line))
          (is (.equals before (.readFileSync fs file))))))))

(def sample-versioned-event
  {:event/id #uuid "00000000-0000-0000-0000-000000000002"
   :event/type :receipt-river/receipt-recorded
   :event/recorded-at #inst "2026-07-29T00:00:00.000Z"
   :event/schema {:id :eta-mu.receipt-river/receipt-recorded :version 1}
   :event/producer {:eta-mu/version "1.1.1"
                    :package/name "@eta-mu/receipt-river"
                    :package/version "0.1.0"}
   :event/subject {:repository/path "/repo"}
   :event/payload sample-event})

(deftest context-bearing-validation-preserves-original-data-and-js-shape
  (let [record (dissoc sample-event :repo)
        line (pr-str record)
        result (receipt-river/validate-edn-event line 17 "/repo")]
    (is (true? (aget result "ok")))
    (is (= record (aget result "event")))
    (is (not (contains? (aget result "event") :repo)))
    (is (= line (aget result "line")))
    (is (= 17 (aget result "lineNumber")))
    (is (= #{"ok" "lineNumber" "event" "errors" "line"}
           (set (js->clj (js/Object.keys result)))))
    (is (js/Array.isArray (aget result "errors")))
    (is (zero? (.-length (aget result "errors"))))
    (doseq [context [nil "" "  " 42 false {} []]]
      (is (false? (aget (receipt-river/validate-edn-event line 17 context) "ok"))))
    (is (false? (aget (receipt-river/validate-edn-event line 17) "ok")))
    (let [explicit (assoc record :repo "/historical")
          result (receipt-river/validate-edn-event (pr-str explicit) 18 "/repo")]
      (is (true? (aget result "ok")))
      (is (= explicit (aget result "event"))))))

(deftest context-bearing-validation-retains-owner-refusals
  (doseq [[label line]
          [[:malformed "{{{"]
           [:non-map "[1 2]"]
           [:ordinary-key (pr-str (dissoc sample-event :repo :origin))]
           [:kind (pr-str (-> sample-event (dissoc :repo) (assoc :kind :unsupported)))]
           [:timestamp (pr-str (-> sample-event (dissoc :repo)
                                  (assoc :ts "2026-02-31T00:00:00.000Z")))]
           [:explicit-nil-repo (pr-str (assoc sample-event :repo nil))]
           [:declared-nil-schema (pr-str (assoc (dissoc sample-event :repo)
                                               :event/schema nil))]
           [:unsupported-version (pr-str (assoc-in sample-versioned-event
                                                   [:event/schema :version] 999))]
           [:envelope-repo (pr-str (update sample-versioned-event :event/payload dissoc :repo))]
           [:envelope-key (pr-str (dissoc sample-versioned-event :event/id))]]]
    (testing (name label)
      (let [result (receipt-river/validate-edn-event line 23 "/repo")]
        (is (false? (aget result "ok")))
        (is (js/Array.isArray (aget result "errors")))
        (is (pos? (.-length (aget result "errors")))))))
  (let [result (receipt-river/validate-edn-event (pr-str sample-versioned-event) 24 "/repo")]
    (is (true? (aget result "ok")))
    (is (= sample-versioned-event (aget result "event")))))

(deftest file-validation-preserves-legacy-two-argument-behavior
  (with-validation-directory
    false
    (fn [root _nested]
      (let [file (path/join root "receipts.edn")
            permissive-legacy-line (pr-str (assoc-in sample-versioned-event
                                                    [:event/schema :version] 999))]
        (doseq [result [(receipt-river/validate-receipt-file file 20)
                        (receipt-river/validate-receipt-file file 20 root)]]
          (is (false? (aget result "ok")))
          (is (= 0 (aget result "count")))
          (is (= ["file does not exist"]
                 (js->clj (aget (.at (aget result "failures") 0) "errors")))))
        (.writeFileSync fs file (str permissive-legacy-line "\n"))
        ;; The historical two-argument surface did not check envelope versions.
        ;; Its file mapper must not accidentally choose the new third arity
        ;; because JavaScript Array.map also passes its input array.
        (is (true? (aget (receipt-river/validate-edn-event permissive-legacy-line 0) "ok")))
        (is (true? (aget (receipt-river/validate-receipt-file file 20) "ok")))
        (is (false? (aget (receipt-river/validate-receipt-file file 20 root) "ok")))
        (let [line (pr-str (dissoc sample-event :repo))
              explicit (pr-str sample-event)
              bytes (str line "\n[1 2]\n" explicit "\n")]
          (.writeFileSync fs file bytes)
          (let [before (.readFileSync fs file)
                result (receipt-river/validate-receipt-file file 20 root)
                failure (.at (aget result "failures") 0)]
            (is (false? (aget result "ok")))
            (is (= 3 (aget result "count")))
            (is (= 1 (.-length (aget result "failures"))))
            (is (= 1 (aget failure "lineNumber")))
            (is (= "[1 2]" (aget failure "line")))
            (is (= explicit (aget (aget result "last") "line")))
            (is (= 2 (aget (aget result "last") "lineNumber")))
            (is (.equals before (.readFileSync fs file)))))
        (.writeFileSync fs file "")
        (doseq [result [(receipt-river/validate-receipt-file file 20)
                        (receipt-river/validate-receipt-file file 20 root)]]
          (is (true? (aget result "ok")))
          (is (= 0 (aget result "count")))
          (is (zero? (.-length (aget result "failures"))))
          (is (nil? (aget result "last"))))))))

(deftest compiled-command-and-tool-use-an-already-active-repository
  (with-validation-directory
    true
    (fn [repo _nested]
      (with-validation-directory
        false
        (fn [cwd _outside-nested]
          (let [file (path/join repo "receipts.edn")
                line (pr-str (dissoc sample-event :repo))]
            (.writeFileSync fs file (str line "\n"))
            (is (nil? (receipt-river/find-git-root cwd)))
            (let [before (.readFileSync fs file)]
              (doseq [result (isolated-validation-routes cwd nil [repo])]
                (is (true? (aget result "ok")))
                (assert-validation-result-shape result file line))
              (is (.equals before (.readFileSync fs file))))))))))

;; ============================================================
;; Ledger resolution shared with the CLI
;; ============================================================

(defn- with-temp-repo [setup f]
  (let [dir (.mkdtempSync fs (path/join (.tmpdir os) "rr-ledger-"))]
    (try
      (setup dir)
      (f dir)
      (finally (.rmSync fs dir #js {:recursive true :force true})))))

(defn- touch! [dir rel]
  (let [file (path/join dir rel)]
    (.mkdirSync fs (path/dirname file) #js {:recursive true})
    (.writeFileSync fs file "")))

(deftest repo-receipt-file-follows-the-cli-ledger-rule-test
  (testing "neither ledger: the root file is the bootstrap location"
    (with-temp-repo (fn [_])
      #(is (= (path/join % "receipts.edn") (receipt-river/repo-receipt-file %)))))
  (testing ".ημ-only repository: the extension writes the project ledger and never bootstraps a root file"
    (with-temp-repo #(touch! % ".ημ/receipts.edn")
      #(is (= (path/join % ".ημ" "receipts.edn") (receipt-river/repo-receipt-file %)))))
  (testing "an existing root ledger always wins, even beside .ημ"
    (with-temp-repo (fn [d] (touch! d "receipts.edn") (touch! d ".ημ/receipts.edn"))
      #(is (= (path/join % "receipts.edn") (receipt-river/repo-receipt-file %)))))
  (testing "no repository: no ledger"
    (is (nil? (receipt-river/repo-receipt-file nil)))))

(deftest ledger-prompt-names-the-selected-ledger-test
  (testing ".ημ-only repository: the instruction points at the project ledger, not a root file"
    (with-temp-repo #(touch! % ".ημ/receipts.edn")
      (fn [dir]
        (let [prompt (receipt-river/inject-ledger-prompt "" [dir] false)]
          (is (re-find #"Maintain append-only \.ημ/receipts\.edn in this repo root" prompt))
          (is (not (re-find #"append-only receipts\.edn" prompt)))))))
  (testing "root ledger present: the instruction names the root ledger"
    (with-temp-repo #(touch! % "receipts.edn")
      (fn [dir]
        (is (re-find #"Maintain append-only receipts\.edn in this repo root"
                     (receipt-river/inject-ledger-prompt "" [dir] false)))))))
