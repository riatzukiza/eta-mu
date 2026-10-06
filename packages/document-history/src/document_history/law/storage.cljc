(ns document-history.law.storage
  "Portable admission for normalized document history storage paths."
  (:require [clojure.string :as str]))

(defn admissible-root?
  "A storage path must contain .ημ as a complete component. The one-arity
   form accepts slash-normalized paths; host adapters supply an explicit
   :posix or :windows dialect at every raw and resolved path boundary.
   Backslash is a literal POSIX filename character, not a separator."
  ([value] (admissible-root? value :posix))
  ([value dialect]
   (let [separator (case dialect :posix #"/+" :windows #"[/\\]+" nil)]
     (boolean (and (string? value) separator
                   (some #{".ημ"} (str/split value separator)))))))

(defn require-root!
  "Refuse a storage path outside .ημ without performing host operations."
  ([value] (require-root! value :posix))
  ([value dialect]
   (when-not (admissible-root? value dialect)
     (throw (ex-info "Document histories and snapshots must reside under .ημ"
                     {:document-history/error :invalid-root})))
   value))
