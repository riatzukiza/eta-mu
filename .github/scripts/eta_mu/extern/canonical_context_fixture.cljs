;; SPDX-License-Identifier: GPL-3.0-or-later
(ns eta-mu.extern.canonical-context-fixture
  "Fixture transport: execute the existing compiler recipe, never review law."
  (:require ["node:child_process" :as child]
            ["node:crypto" :as crypto]
            ["node:fs" :as fs]
            ["node:module" :as module]
            ["node:path" :as path]))

(defn- digest [bytes]
  (-> (.createHash crypto "sha256") (.update bytes) (.digest "hex")))

(defn- write-provenance! [file data]
  (.writeFileSync fs file (str (.stringify js/JSON (clj->js data) nil 2) "\n")))

(let [;; The fixed pnpm command launches this adapter from packages/eta-mu.
      root (.resolve path (.cwd js/process) "../..")
      require-from-eta-mu (.createRequire module (.join path root "packages/eta-mu/package.json"))
      yaml (require-from-eta-mu "yaml")
      workflow (js->clj (.parse yaml (.readFileSync fs (.join path root ".github/workflows/opencode-code-review.yml") "utf8"))
                       :keywordize-keys true)
      revision (get-in workflow [:on :workflow_call :inputs :muse_revision :default])
      cli-version (get-in workflow [:on :workflow_call :inputs :opencode_version :default])
      steps (get-in workflow [:jobs :prepare_review_context :steps])
      checkout (first (filter #(= "Checkout Muse compatibility compiler" (:name %)) steps))
      recipe (:run (first (filter #(= "Compile and verify a read-only Muse review profile" (:name %)) steps)))
      output (first *command-line-args*)]
  (when-not (and (string? revision) (re-matches #"[0-9a-f]{40}" revision)
                 (= "riatzukiza/muse" (get-in checkout [:with :repository]))
                 (string? recipe) (seq recipe))
    (throw (js/Error. "canonical fixture needs the existing immutable Muse compiler recipe")))
  (when-not (and output (.isAbsolute path output))
    (throw (js/Error. "supply a new absolute fixture output directory")))
  (.mkdirSync fs output) ;; Refuse existing output rather than reuse a stale module.
  (let [source (.join path output "source")
        recipe-file (.join path output "compile.sh")
        provenance-file (.join path output "provenance.json")
        provenance {:tier "compiled-fixture" :repository (get-in checkout [:with :repository])
                    :revision revision :recipe_sha256 (digest recipe) :completed false}
        run-command! (fn [command args timeout]
                       (.execFileSync child command (clj->js args)
                                      #js {:cwd source :stdio "inherit" :timeout timeout}))]
    (.mkdirSync fs source)
    (.writeFileSync fs recipe-file recipe)
    (write-provenance! provenance-file provenance)
    (run-command! "git" ["init" "--quiet"] 120000)
    (run-command! "git" ["fetch" "--depth=1" "https://github.com/riatzukiza/muse.git" revision] 120000)
    (run-command! "git" ["checkout" "--quiet" "--detach" "FETCH_HEAD"] 120000)
    (let [actual (.trim (.execFileSync child "git" #js ["rev-parse" "HEAD"] #js {:cwd source :encoding "utf8"}))]
      (when-not (= actual revision)
        (throw (js/Error. "canonical fixture checkout changed revision"))))
    (run-command! "bash" ["--noprofile" "--norc" "-e" "-o" "pipefail" recipe-file] 900000)
    (let [compiled (.join path source ".opencode/dist/review-invocation.cjs")]
      (when-not (.isFile (.lstatSync fs compiled))
        (throw (js/Error. "compiler did not produce a regular invocation module")))
      (let [bytes (.readFileSync fs compiled)
            module-file (.join path output "review-invocation.cjs")
            complete (assoc provenance :completed true :module_bytes (.-length bytes) :module_sha256 (digest bytes))]
        (when (zero? (.-length bytes))
          (throw (js/Error. "compiler produced an empty invocation module")))
        (.writeFileSync fs module-file bytes #js {:flag "wx"})
        ;; Keep the actual compiler outputs for real CLI/producer integration,
        ;; not just a cached verifier or synthetic registry assertion.
        (let [profile (.join path output "profile")]
          (.mkdirSync fs profile)
          (doseq [relative ["dist" "plugins" "agents" "opencode.json"
                            "package.json" "exposed-tools.txt"]]
            (.cpSync fs (.join path source ".opencode" relative)
                     (.join path profile relative) #js {:recursive true})))
        ;; The existing Sandbox full-suite caller also needs the actual host,
        ;; inside its owned fixture output. Never upgrade a global installation.
        (when-not (and (string? cli-version) (re-matches #"\d+\.\d+\.\d+" cli-version))
          (throw (js/Error. "native batching fixture requires the selected CLI version")))
        (if (and (= "linux" (.-platform js/process)) (= "x64" (.-arch js/process)))
          (run-command! "npm" ["install" "--prefix" (.join path output "native-cli")
                               "--ignore-scripts" "--no-audit" "--no-fund"
                               (str "opencode-linux-x64@" cli-version)] 120000)
          (println "Skipping native Linux x64 CLI fixture on" (.-platform js/process) (.-arch js/process)))
        (write-provenance! provenance-file complete)
        (println "Compiled canonical fixture" revision (.-length bytes) "bytes" (:module_sha256 complete))))
    ;; This invocation exclusively created source. Retain module/recipe/provenance
    ;; before discarding only its regenerable fetched/build tree.
    (.rmSync fs source #js {:recursive true})))
