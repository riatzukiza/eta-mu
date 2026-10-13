;; SPDX-License-Identifier: GPL-3.0-or-later
;; Outer offline regression harness. Muse remains the framing/verification owner.
(ns cephalon-host-spike.extern.replay-custody-test
  (:require [cljs.test :refer [deftest is run-tests]]
            [clojure.string :as str]
            ["node:fs" :as fs]
            ["node:path" :as path]
            ["node:os" :as os]
            ["node:crypto" :as crypto]
            ["node:child_process" :as cp]))

(def archive (.resolve path (or (first *command-line-args*)
                               ".ημ/review-evidence/cephalon-review-context-adoption/host-read-spike-20261013")))
(def module-path (aget (.-env js/process) "MUSE_REVIEW_INVOCATION_MODULE"))
(assert (and module-path (.existsSync fs module-path))
        "Provide the existing qualified Muse artifact, no compilation or inference is performed")
(def input-files ["replay-canonical-host-framing-controls.mjs"
                  "prepared-probe-inputs.json" "genuine-host-read.stdout.jsonl"
                  "canonical-host-framing-control-results.json" "archived-replay-results.json"
                  "fixture/AGENTS.md" "fixture/empty-context.md"
                  "fixture/large-context.md" "fixture/clipped-context.md"])

(defn digest [bytes]
  (-> (.createHash crypto "sha256") (.update bytes) (.digest "hex")))

(defn snapshot [dir]
  (into (sorted-map)
        (for [entry (js->clj (.readdirSync fs dir #js {:recursive true}))
              :let [file (.join path dir entry)]
              :when (.isFile (.statSync fs file))]
          [entry (digest (.readFileSync fs file))])))

(defn run-copy [mutate assert-result]
  (let [root (.mkdtempSync fs (.join path (.tmpdir os) "cephalon-replay-custody-test-"))
        dir (.join path root "archive")]
    (try
      (.mkdirSync fs dir)
      (doseq [name input-files]
        (.mkdirSync fs (.dirname path (.join path dir name)) #js {:recursive true})
        (.copyFileSync fs (.join path archive name) (.join path dir name)))
      (mutate dir)
      (let [before (snapshot dir)
            env (.assign js/Object #js {} (.-env js/process)
                         #js {:MUSE_REVIEW_INVOCATION_MODULE module-path :TMPDIR root})
            result (.spawnSync cp (or (aget (.-env js/process) "REPLAY_NODE") "node")
                               #js [(str dir "/replay-canonical-host-framing-controls.mjs")]
                               #js {:cwd dir :env env :encoding "utf8" :timeout 10000})]
        (is (nil? (.-error result)) "The bounded offline command actually executed")
        (assert-result dir result)
        (is (= before (snapshot dir)) "Replay must preserve all input and historical result bytes"))
      (finally
        ;; This is only this invocation's unique owned test directory.
        (.rmSync fs root #js {:recursive true :force true})))))

(defn refuse [message]
  (fn [_ result]
    (is (not= 0 (.-status result)) "Corrupt archived input must refuse")
    (is (str/includes? (.-stderr result) message) "Custody guard must refuse before canonical interpretation")
    (is (str/blank? (.-stdout result)) "Refused input must not produce a passing report")))

(deftest genuine-replay-preserves-archive
  (run-copy identity
            (fn [dir result]
              (is (= 0 (.-status result)) (.-stderr result))
              (let [report (js->clj (js/JSON.parse (str/trim (.-stdout result))) :keywordize-keys true)]
                (is (= 9 (:controls report)))
                (is (true? (:allAssertionsPassed report)))
                (is (= 5 (:nativeCompletedReads report)))
                (is (string? (:reportPath report)) "Return the fresh report path")
                (when (string? (:reportPath report))
                  (is (.existsSync fs (:reportPath report)))
                  (is (not= dir (.dirname path (:reportPath report)))))))))

(deftest non-read-event-custody
  (run-copy
   (fn [dir]
     (let [file (.join path dir "genuine-host-read.stdout.jsonl")
           events (mapv #(js->clj (js/JSON.parse %) :keywordize-keys true)
                        (str/split-lines (.readFileSync fs file "utf8")))
           index (first (keep-indexed #(when (not= "tool_use" (:type %2)) %1) events))]
       (assert (some? index) "The genuine trace contains a non-read event")
       (.writeFileSync fs file
                       (str (str/join "\n" (map #(js/JSON.stringify (clj->js %))
                                                (update events index assoc :custody-test "corrupt"))) "\n"))))
   (refuse "custody: native HOST trace")))

(deftest raw-trace-byte-custody
  (run-copy #(.appendFileSync fs (.join path % "genuine-host-read.stdout.jsonl") "\n")
            (refuse "custody: native HOST trace")))

(deftest prepared-manifest-byte-custody
  (run-copy #(.appendFileSync fs (.join path % "prepared-probe-inputs.json") " ")
            (refuse "custody: prepared fixture manifest")))

(deftest every-fixture-byte-custody
  (doseq [file ["fixture/AGENTS.md" "fixture/empty-context.md"
                "fixture/large-context.md" "fixture/clipped-context.md"]]
    (run-copy #(.appendFileSync fs (.join path % file) "corrupt")
              (refuse "custody: fixture"))))

(defmethod cljs.test/report [:cljs.test/default :end-run-tests] [result]
  (when-not (cljs.test/successful? result) (set! (.-exitCode js/process) 1)))
(run-tests 'cephalon-host-spike.extern.replay-custody-test)
