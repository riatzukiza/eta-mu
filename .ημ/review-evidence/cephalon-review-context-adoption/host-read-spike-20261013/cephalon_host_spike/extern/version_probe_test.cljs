;; SPDX-License-Identifier: GPL-3.0-or-later
;; Offline subprocess-boundary tests: controlled synthetic client, no inference.
(ns cephalon-host-spike.extern.version-probe-test
  (:require [cljs.test :refer [deftest is run-tests]]
            [clojure.string :as str]
            ["node:fs" :as fs]
            ["node:path" :as path]
            ["node:os" :as os]
            ["node:child_process" :as cp]))

(def archive (.resolve path (or (first *command-line-args*)
                               ".ημ/review-evidence/cephalon-review-context-adoption/host-read-spike-20261013")))

(defn clean-owned-client! [root]
  (let [pid-file (.join path root "synthetic-client.pid")]
    (when (.existsSync fs pid-file)
      (let [pid (js/parseInt (.readFileSync fs pid-file "utf8"))
            cmd-file (str "/proc/" pid "/cmdline")]
        (when (and (.existsSync fs cmd-file)
                   (str/includes? (.readFileSync fs cmd-file "utf8")
                                  (.join path root "client/package/bin/opencode")))
          ;; Only this test's own sleeping fake, verified by its unique command path.
          (.kill js/process pid "SIGTERM"))))))

(defn run-synthetic-client [mode verify]
  (let [root (.mkdtempSync fs (.join path (.tmpdir os) "cephalon-version-probe-test-"))
        client (.join path root "client/package/bin/opencode")]
    (try
      (.mkdirSync fs (.dirname path client) #js {:recursive true})
      (.mkdirSync fs (.join path root "probe-project/fixture") #js {:recursive true})
      (.copyFileSync fs (.join path archive "invoke-genuine-host-read.py")
                       (.join path root "invoke-genuine-host-read.py"))
      (.writeFileSync fs (.join path root "probe-opencode-config.json")
                      "{\"model\":\"synthetic/offline-no-provider\"}\n")
      (.writeFileSync fs (.join path root "host-read-probe-prompt.txt")
                      "Synthetic subprocess test. No model or tool invocation.\n")
      (.writeFileSync fs client
                      (str "#!/usr/bin/python3\nimport sys,time,os\nfrom pathlib import Path\n"
                           "root=Path(__file__).resolve().parents[3]\n"
                           "if sys.argv[1:] == ['--version']:\n"
                           "    (root/'synthetic-client.pid').write_text(str(os.getpid()))\n"
                           (case mode
                             :hang "    time.sleep(60)\n"
                             :wrong "    print('1.18.32')\n"
                             "    print('1.18.31')\n")
                           "else:\n    (root/'synthetic-run-invoked').write_text('synthetic only')\n"
                           "    print('{\"synthetic\":true,\"providerInvoked\":false}')\n"))
      (.chmodSync fs client 493)
      (let [start (.now js/Date)
            result (.spawnSync cp "/usr/bin/python3"
                               #js [(.join path root "invoke-genuine-host-read.py")]
                               #js {:cwd root :encoding "utf8" :timeout 13000})]
        (verify root result (- (.now js/Date) start)))
      (finally
        (clean-owned-client! root)
        (.rmSync fs root #js {:recursive true :force true})))))

(deftest hung-version-refuses-without-starting-diagnostic
  (run-synthetic-client
   :hang
   (fn [root result elapsed]
     (is (nil? (.-error result)) "Adapter's own bound must fire before outer safety timeout")
     (is (= 124 (.-status result)) "Version timeout is an explicit terminal diagnostic failure")
     (is (< elapsed 12500))
     (is (not (.existsSync fs (.join path root "synthetic-run-invoked"))))
     (is (not (.existsSync fs (.join path root "genuine-host-read.stdout.jsonl"))))
     (let [reports (filter #(str/starts-with? % "genuine-host-read-version-failure-")
                           (js->clj (.readdirSync fs root)))]
       (is (= 1 (count reports)) "Retain one uniquely named failure report")
       (when (= 1 (count reports))
         (let [report (js->clj (js/JSON.parse (.readFileSync fs (.join path root (first reports)) "utf8"))
                              :keywordize-keys true)]
           (is (= "version" (:stage report)))
           (is (= 124 (:exitCode report)))
           (is (true? (:timedOut report)))
           (is (= 10 (:timeoutSeconds report))))))
     (let [pid (str/trim (.readFileSync fs (.join path root "synthetic-client.pid") "utf8"))]
       (is (not (.existsSync fs (str "/proc/" pid "/cmdline")))
           "subprocess timeout must reap its own fake child")))))

(deftest matching-version-keeps-existing-success-path
  (run-synthetic-client
   :success
   (fn [root result _elapsed]
     (is (nil? (.-error result)))
     (is (= 0 (.-status result)) (.-stderr result))
     (is (.existsSync fs (.join path root "synthetic-run-invoked")))
     (let [report (js->clj (js/JSON.parse (.readFileSync fs (.join path root "genuine-host-read-invocation.json") "utf8"))
                          :keywordize-keys true)]
       (is (= "1.18.31" (:clientVersion report)))
       (is (= 0 (:exitCode report)))
       (is (false? (:timedOut report)))))))

(deftest wrong-version-preserves-existing-refusal
  (run-synthetic-client
   :wrong
   (fn [root result _elapsed]
     (is (nil? (.-error result)))
     (is (not= 0 (.-status result)))
     (is (not (.existsSync fs (.join path root "synthetic-run-invoked")))))))

(defmethod cljs.test/report [:cljs.test/default :end-run-tests] [result]
  (when-not (cljs.test/successful? result) (set! (.-exitCode js/process) 1)))
(run-tests 'cephalon-host-spike.extern.version-probe-test)
