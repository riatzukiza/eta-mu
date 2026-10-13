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

(defn terminal-pid? [pid]
  (let [stat-file (str "/proc/" pid "/stat")]
    (or (not (.existsSync fs stat-file))
        (= "Z" (second (re-find #"\)\s+([A-Z])" (.readFileSync fs stat-file "utf8")))))))

(defn clean-owned-client! [root]
  (doseq [name ["synthetic-client.pid" "synthetic-grandchild.pid"]]
   (let [pid-file (.join path root name)]
    (when (.existsSync fs pid-file)
      (let [pid (js/parseInt (.readFileSync fs pid-file "utf8"))
            cmd-file (str "/proc/" pid "/cmdline")]
        (when (and (.existsSync fs cmd-file)
                   (str/includes? (.readFileSync fs cmd-file "utf8")
                                  root))
          ;; Only this test's own sleeping fake, verified by its unique command path.
          (.kill js/process pid "SIGTERM")))))))

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
      (.writeFileSync fs (.join path root "synthetic-grandchild.py")
                      "import os,time\nfrom pathlib import Path\nroot=Path(__file__).resolve().parent\n(root/'synthetic-grandchild.pid').write_text(str(os.getpid()))\ntime.sleep(60)\n")
      (.writeFileSync fs client
                      (str "#!/usr/bin/python3\nimport sys,time,os,subprocess\nfrom pathlib import Path\n"
                           "root=Path(__file__).resolve().parents[3]\n"
                           "if sys.argv[1:] == ['--version']:\n"
                           "    (root/'synthetic-client.pid').write_text(str(os.getpid()))\n"
                           (case mode
                             :hang "    time.sleep(60)\n"
                             :wrong "    print('1.18.32')\n"
                             :wrong-optimized "    print('1.18.32')\n"
                             :version-tree "    subprocess.Popen(['/usr/bin/python3',str(root/'synthetic-grandchild.py')])\n    time.sleep(60)\n"
                             "    print('1.18.31')\n")
                           "else:\n    (root/'synthetic-run-invoked').write_text('synthetic only')\n"
                           (when (= mode :run-tree)
                             "    subprocess.Popen(['/usr/bin/python3',str(root/'synthetic-grandchild.py')])\n    time.sleep(60)\n")
                           "    print('{\"synthetic\":true,\"providerInvoked\":false}')\n"))
      (.chmodSync fs client 493)
      (when (= mode :run-tree)
        ;; Only this controlled offline copy shortens the diagnostic budget.
        ;; The production 600-second value is unchanged.
        (let [file (.join path root "invoke-genuine-host-read.py")
              source (.readFileSync fs file "utf8")]
          (assert (str/includes? source "timeout=600"))
          (.writeFileSync fs file (str/replace source "timeout=600" "timeout=1"))))
      (let [start (.now js/Date)
            args (cond-> [] (= mode :wrong-optimized) (conj "-O")
                   true (conj (.join path root "invoke-genuine-host-read.py")))
            result (.spawnSync cp "/usr/bin/python3"
                               (clj->js args)
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

(deftest optimized-python-still-refuses-wrong-version
  (run-synthetic-client
   :wrong-optimized
   (fn [root result _elapsed]
     (is (nil? (.-error result)))
     (is (not= 0 (.-status result)))
     (is (not (.existsSync fs (.join path root "synthetic-run-invoked")))))))

(deftest version-timeout-terminates-forked-child
  (run-synthetic-client
   :version-tree
   (fn [root result elapsed]
     (is (nil? (.-error result)))
     (is (= 124 (.-status result)))
     (is (< elapsed 12500))
     (let [pid-file (.join path root "synthetic-grandchild.pid")]
       (is (.existsSync fs pid-file))
       (when (.existsSync fs pid-file)
         (is (terminal-pid? (str/trim (.readFileSync fs pid-file "utf8"))))))
     (is (not (.existsSync fs (.join path root "synthetic-run-invoked")))))))

(deftest diagnostic-timeout-terminates-forked-child
  (run-synthetic-client
   :run-tree
   (fn [root result elapsed]
     (is (nil? (.-error result)))
     (is (= 124 (.-status result)))
     (is (< elapsed 3500))
     (is (.existsSync fs (.join path root "synthetic-run-invoked")))
     (let [pid-file (.join path root "synthetic-grandchild.pid")]
       (is (.existsSync fs pid-file))
       (when (.existsSync fs pid-file)
         (is (terminal-pid? (str/trim (.readFileSync fs pid-file "utf8")))))))))

(defmethod cljs.test/report [:cljs.test/default :end-run-tests] [result]
  (when-not (cljs.test/successful? result) (set! (.-exitCode js/process) 1)))
(run-tests 'cephalon-host-spike.extern.version-probe-test)
