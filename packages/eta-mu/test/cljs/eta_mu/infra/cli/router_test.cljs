(ns eta-mu.infra.cli.router-test
  (:require [clojure.string :as str]
            [cljs.test :refer [deftest is testing]]
            ["node:fs" :as fs]
            ["node:os" :as os]
            ["node:path" :as path]
            [eta-mu.domain.component-manifest :as component-manifest]
            [eta-mu.infra.cli.commands.sessions :as sessions]
            [eta-mu.infra.cli.router :as cli-router]
            [eta-mu.receipt-river.api :as receipt-api]
            [eta-mu.receipt-river.extern.crypto :as crypto]
            [eta-mu.receipt-river.extern.git :as git]
            [eta-mu.receipt-river.extern.runtime :as runtime]
            [eta-mu.receipt-river.shape.edn :as edn]))

(deftest cljs-component-manifest-test
  (let [manifest component-manifest/manifest]
    (is (= "1.1.1" (:eta-mu/version manifest)))
    (is (= {"@eta-mu/receipt-river" "0.1.0"
            "@eta-mu/session-mycology" "0.1.0"
            "@eta-mu/fork-tax" "0.1.0"}
           (:components manifest)))
    (is (= {:eta-mu.receipt-river/receipt-recorded 1
            :eta-mu.session-mycology/reflection-recorded 1
            :eta-mu.fork-tax/handoff-recorded 1}
           (:schemas manifest)))))

(deftest ledger-command-surface-test
  (let [registry (cli-router/command-registry)]
    (testing "canonical top-level commands exist"
      (is (fn? (get-in registry ["receipt" :handler])))
      (is (fn? (get-in registry ["session" :handler])))
      (is (fn? (get-in registry ["fork-tax" :handler]))))
    (testing "descriptive aliases share the canonical implementations"
      (is (identical? (get-in registry ["receipt" :handler])
                      (get-in registry ["receipt-river" :handler]))))
    (testing "git compatibility commands delegate to those same handlers"
      (is (identical? (get-in registry ["receipt" :handler])
                      (get-in registry ["git" :subcommands "receipt" :handler])))
      (is (identical? (get-in registry ["session-mycology" :handler])
                      (get-in registry ["git" :subcommands "session" :handler])))
      (is (identical? (get-in registry ["fork-tax" :handler])
                      (get-in registry ["git" :subcommands "fork-tax" :handler]))))
    (testing "persisted agent-session inspection remains available in plural form"
      (is (fn? (get-in registry ["sessions" :handler]))))))

(deftest ^:async session-multiplexer-test
  (let [calls (atom [])
        protocol-stub (fn [context]
                        (swap! calls conj [:protocol (:args context)])
                        (js/Promise.resolve :protocol))
        inspection-stub (fn [context]
                          (swap! calls conj [:inspection (:args context)])
                          (js/Promise.resolve :inspection))]
    (with-redefs [cli-router/session-protocol-handler protocol-stub
                  sessions/handle inspection-stub]
      (doseq [subcommand ["reflect" "schemas"]]
        (is (= :protocol
               (await (cli-router/session-handler {:args [subcommand]})))))
      (doseq [subcommand ["list" "show"]]
        (is (= :inspection
               (await (cli-router/session-handler {:args [subcommand]}))))))
    (is (= [[:protocol ["reflect"]]
            [:protocol ["schemas"]]
            [:inspection ["list"]]
            [:inspection ["show"]]]
           @calls))))

(defn- ^:async frozen-receiver-prefix
  "Read the immutable physical prefix from the real source Git root."
  []
  (let [{:keys [exit stdout]} (await (git/exec-at (runtime/current-directory)
                                                ["rev-parse" "--show-toplevel"]))]
    (when-not (zero? exit)
      (throw (ex-info "Cannot resolve receiver fixture source" {:exit exit})))
    (let [lines (take 258 (str/split-lines
                          (.readFileSync fs (path/join stdout "receipts.edn") "utf8")))
          prefix (str (str/join "\n" lines) "\n")]
      (when-not (and (= 258 (count lines))
                     (= 320957 (.-length (js/Buffer.from prefix "utf8")))
                     (= "9e9929aed4c42265f6ff24bf655576dfe10729c3aeb3b4270fe68d8142e8d6ff"
                        (crypto/short-sha256 prefix 64)))
        (throw (ex-info "Immutable receiver prefix drifted" {})))
      prefix)))

(defn- ^:async observe-receipt-route
  "Record actual default-window calls while executing the owning validator."
  [nested]
  (let [validate receipt-api/validate-line
        observed (atom [])
        exits (atom [])
        record-result (fn [line ordinal containing result]
                        (swap! observed conj {:line line :ordinal ordinal
                                              :containing containing :result result})
                        result)
        record-validation (fn
                            ([line ordinal]
                             (record-result line ordinal nil (validate line ordinal)))
                            ([line ordinal containing]
                             (record-result line ordinal containing
                                            (apply validate [line ordinal containing]))))]
    (with-redefs [runtime/current-directory (constantly nested)
                  runtime/exit! #(swap! exits conj %)
                  receipt-api/validate-line record-validation]
      (await (cli-router/receipt-handler {:args ["validate"]
                                         :raw-args ["receipt" "validate"]})))
    {:rows @observed :exits @exits}))

(deftest ^:async receipt-route-containing-checkout-test
  ;; Git and filesystem operations below belong only to this test fixture.
  (doseq [variable ["GIT_DIR" "GIT_WORK_TREE" "GIT_COMMON_DIR" "GIT_INDEX_FILE"
                    "GIT_OBJECT_DIRECTORY" "GIT_ALTERNATE_OBJECT_DIRECTORIES"]]
    (when (some? (aget js/process.env variable))
      (throw (ex-info "Fixture refuses Git repository redirection" {:variable variable}))))
  ;; Resolve/read the source before the fixture changes the cwd accessor.
  (let [prefix (await (frozen-receiver-prefix))
        lines (str/split-lines prefix)
        window (subvec lines 58 258)
        originals (subvec lines 255 258)
        baselines (mapv (fn [index line] (receipt-api/validate-line line (+ 59 index)))
                        (range 200) window)
        invalid-base (filterv #(and (< (:line-number %) 256) (false? (:ok %))) baselines)
        root (.mkdtempSync fs (path/join (.tmpdir os) "eta-mu-receipt-route-"))
        nested (path/join root "nested")
        ledger (path/join root "receipts.edn")]
    (try
      (.mkdirSync fs nested)
      (.writeFileSync fs ledger prefix "utf8")
      (let [initialized (await (git/exec-at root ["init" "--quiet"
                                                 "--initial-branch=receipt-route-fixture"]))
            resolved (await (git/exec-at nested ["rev-parse" "--show-toplevel"]))]
        (when-not (and (zero? (:exit initialized)) (zero? (:exit resolved))
                       (= (.realpathSync fs root) (.realpathSync fs (:stdout resolved))))
          (throw (ex-info "Owned Git fixture setup failed" {})))
        (let [containing (:stdout resolved)
              attribution {:path containing :basis :containing-repository :tier :derived}
              observed (await (observe-receipt-route nested))
              rows (:rows observed)]
          (testing "actual root resolution and default200 window"
            (is (= 200 (count rows)))
            (is (= (vec (range 59 259)) (mapv :ordinal rows)))
            (is (= window (mapv :line rows)))
            (is (= #{containing} (set (map :containing rows))))
            (is (= prefix (.readFileSync fs ledger "utf8"))))
          (testing "original256-258 acquire only derived containing attribution"
            (doseq [index (range 3)]
              (let [baseline (nth baselines (+ 197 index))
                    result (:result (nth rows (+ 197 index)))]
                (is (= ["missing required key: repo"] (:errors baseline)))
                (is (:ok result))
                (is (= [] (:errors result)))
                (is (= (:errors baseline) (:source/context-free-errors result)))
                (is (= attribution (:source/repository result)))
                (is (= (nth originals index) (:line result)))
                (is (= (+ 256 index) (:line-number result)))
                (is (= (:event baseline) (:event result)))
                (is (= {:status :unversioned} (:source/schema result)))
                (is (not (contains? (:event result) :repo)))
                (is (not (contains? (:event result) :event/schema))))))
          (testing "unrelated baseline-invalid rows are not a whole-journal PASS"
            (is (seq invalid-base))
            (is (= [1] (:exits observed)))
            (is (some #(false? (get-in % [:result :ok])) (take 197 rows)))
            (is (= (mapv (fn [baseline]
                           (let [result (:result (nth rows (- (:line-number baseline) 59)))]
                             (if (:source/repository result)
                               (filterv #(not= "missing required key: repo" %) (:errors baseline))
                               (:errors baseline))))
                         invalid-base)
                   (mapv #(get-in rows [(- (:line-number %) 59) :result :errors]) invalid-base))))
          (let [original (:event (nth baselines 197))
                declared (receipt-api/build-event
                           {:event-id #uuid "00000000-0000-0000-0000-000000000003"
                            :recorded-at "2026-10-09T00:00:00.000Z"
                            :component-manifest component-manifest/manifest
                            :command "receipt-route-fixture" :producer {}
                            :subject {:repository/path containing}}
                           original)
                controls [declared (assoc original :repo nil)
                          (dissoc original :owner) (assoc original :event/schema nil)]
                control-lines (mapv edn/format-line controls)
                control-baselines (mapv (fn [index line]
                                          (receipt-api/validate-line line (+ 259 index)))
                                        (range 4) control-lines)
                suffix (str (str/join "\n" control-lines) "\n")]
            (.appendFileSync fs ledger suffix "utf8")
            (let [mixed (await (observe-receipt-route nested))
                  mixed-rows (:rows mixed)
                  results (mapv :result (subvec mixed-rows 196 200))]
              (is (= 200 (count mixed-rows)))
              (is (= (vec (range 63 263)) (mapv :ordinal mixed-rows)))
              (is (= (into (subvec lines 62 258) control-lines) (mapv :line mixed-rows)))
              (is (= #{containing} (set (map :containing mixed-rows))))
              (is (= [1] (:exits mixed)))
              (is (= (mapv :event (subvec baselines 197 200))
                     (mapv #(get-in % [:result :event]) (subvec mixed-rows 193 196))))
              (doseq [index (range 4)]
                (let [baseline (nth control-baselines index)
                      result (nth results index)]
                  (is (false? (:ok result)))
                  (is (= (nth controls index) (:event result)))
                  (is (= (nth control-lines index) (:line result)))
                  (is (= (+ 259 index) (:line-number result)))
                  (is (= (:errors baseline) (:source/context-free-errors result)))
                  (is (= (:source/schema baseline) (:source/schema result)))
                  (if (= 2 index)
                    (do
                      (is (= attribution (:source/repository result)))
                      (is (= (filterv #(not= "missing required key: repo" %) (:errors baseline))
                             (:errors result))))
                    (do
                      (is (not (contains? result :source/repository)))
                      (is (= (:errors baseline) (:errors result)))))))
              (is (= (str prefix suffix) (.readFileSync fs ledger "utf8")))))))
      (finally
        (.rmSync fs root #js {:recursive true :force true})))))

(deftest ^:async receipt-route-without-containing-checkout-test
  ;; No inherited metadata, work tree, or config may redirect the real Git probe.
  (doseq [variable ["GIT_DIR" "GIT_WORK_TREE" "GIT_COMMON_DIR" "GIT_INDEX_FILE"
                    "GIT_OBJECT_DIRECTORY" "GIT_ALTERNATE_OBJECT_DIRECTORIES"
                    "GIT_CONFIG" "GIT_CONFIG_SYSTEM" "GIT_CONFIG_GLOBAL"
                    "GIT_CONFIG_PARAMETERS" "GIT_CONFIG_COUNT"
                    "GIT_CEILING_DIRECTORIES" "GIT_DISCOVERY_ACROSS_FILESYSTEM"]]
    (when (some? (aget js/process.env variable))
      (throw (ex-info "Fixture refuses Git repository redirection" {:variable variable}))))
  ;; Reuse the anchored source prefix; do not synthesize or reserialize its rows.
  (let [prefix (await (frozen-receiver-prefix))
        lines (str/split-lines prefix)
        window (subvec lines 58 258)
        originals (subvec lines 255 258)
        baselines (mapv (fn [index line]
                          (receipt-api/validate-line line (+ 256 index)))
                        (range 3) originals)
        root (.mkdtempSync fs (path/join (.tmpdir os) "eta-mu-receipt-route-no-git-"))
        ledger (path/join root "receipts.edn")]
    (try
      (.writeFileSync fs ledger prefix "utf8")
      (let [resolved (await (git/exec-at root ["rev-parse" "--show-toplevel"]))]
        (when-not (and (not (.existsSync fs (path/join root ".git")))
                       (= 128 (:exit resolved))
                       (str/blank? (:stdout resolved))
                       (str/includes? (:stderr resolved) "not a git repository"))
          (throw (ex-info "Owned fixture must have no containing Git repository"
                          {:exit (:exit resolved)})))
        (let [observed (await (observe-receipt-route root))
              rows (:rows observed)]
          (testing "actual no-Git working directory and default200 window"
            (is (= 200 (count rows)))
            (is (= (vec (range 59 259)) (mapv :ordinal rows)))
            (is (= window (mapv :line rows)))
            (is (= #{nil} (set (map :containing rows))))
            (is (= [1] (:exits observed)))
            (is (= prefix (.readFileSync fs ledger "utf8")))
            (is (not (.existsSync fs (path/join root ".git")))))
          (testing "original256-258 retain missing-repo errors and no derived repository"
            (doseq [index (range 3)]
              (let [baseline (nth baselines index)
                    result (:result (nth rows (+ 197 index)))]
                (is (= ["missing required key: repo"] (:errors baseline)))
                (is (false? (:ok result)))
                (is (= (:errors baseline) (:errors result)))
                (is (= baseline result))
                (is (not (contains? result :source/repository)))
                (is (= (nth originals index) (:line result)))
                (is (= (+ 256 index) (:line-number result)))
                (is (= (:event baseline) (:event result)))
                (is (= {:status :unversioned} (:source/schema result)))
                (is (not (contains? (:event result) :repo)))
                (is (not (contains? (:event result) :event/schema))))))))
      (finally
        (.rmSync fs root #js {:recursive true :force true})))))
