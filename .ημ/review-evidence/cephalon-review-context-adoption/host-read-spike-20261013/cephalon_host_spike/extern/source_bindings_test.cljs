;; SPDX-License-Identifier: GPL-3.0-or-later
;; Authenticate this evidence index only; execute no archived sources or models.
(ns cephalon-host-spike.extern.source-bindings-test
  (:require [cljs.test :refer [deftest is run-tests]]
            ["node:fs" :as fs]
            ["node:crypto" :as crypto]))

(def evidence-path ".ημ/review-evidence/cephalon-review-context-adoption/host-read-spike-20261013/decision-and-evidence.json")
(def evidence (js->clj (js/JSON.parse (.readFileSync fs evidence-path "utf8")) :keywordize-keys true))
(defn digest [bytes]
  (-> (.createHash crypto "sha256") (.update bytes) (.digest "hex")))

(deftest retained-artifacts-are-authentic-at-their-indexed-paths
  (doseq [{:keys [path bytes sha256]} (:retainedEvidence evidence)]
    (is (.existsSync fs path) path)
    (when (.existsSync fs path)
      (let [actual (.readFileSync fs path)]
        (is (= bytes (.-length actual)) path)
        (is (= sha256 (digest actual)) path)))))

(deftest archived-replay-source-is-retained
  (let [{:keys [sourcePath sourceSha256]} (:offlineArchivedReplay evidence)]
    (is (.existsSync fs sourcePath))
    (when (.existsSync fs sourcePath)
      (is (= sourceSha256 (digest (.readFileSync fs sourcePath)))))))

(deftest current-adapters-have-separate-identities
  (let [current (:currentSourceAdapters evidence)]
    (is (= 2 (count current)))
    (is (= 2 (count (set (map :path current)))) "The two adapters must have distinct paths")
    (doseq [{:keys [path bytes sha256]} current]
      (is (.existsSync fs path))
      (when (.existsSync fs path)
        (let [actual (.readFileSync fs path)]
          (is (= bytes (.-length actual)))
          (is (= sha256 (digest actual))))))))

(deftest original-index-snapshot-remains-authentic
  (let [{:keys [path bytes sha256]} (:originalIndexSnapshot evidence)]
    (is (string? path))
    (when (string? path)
      (is (.existsSync fs path))
      (when (.existsSync fs path)
        (let [actual (.readFileSync fs path)]
          (is (= bytes (.-length actual)))
          (is (= sha256 (digest actual))))))))

(defmethod cljs.test/report [:cljs.test/default :end-run-tests] [result]
  (when-not (cljs.test/successful? result) (set! (.-exitCode js/process) 1)))
(run-tests 'cephalon-host-spike.extern.source-bindings-test)
