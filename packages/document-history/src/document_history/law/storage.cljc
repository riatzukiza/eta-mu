(ns document-history.law.storage
  "Portable admission for normalized document history storage paths."
  (:require [clojure.string :as str]))

(defn admissible-root?
  "A storage path must contain .ημ as a complete component. Host adapters
   normalize and resolve paths before applying this policy at each boundary."
  [value]
  (and (string? value)
       (boolean (some #{".ημ"} (str/split value #"[/\\]+")))))

(defn require-root!
  "Refuse a storage path outside .ημ without performing host operations."
  [value]
  (when-not (admissible-root? value)
    (throw (ex-info "Document histories and snapshots must reside under .ημ"
                    {:document-history/error :invalid-root})))
  value)
