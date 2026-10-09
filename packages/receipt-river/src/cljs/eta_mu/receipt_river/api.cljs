(ns eta-mu.receipt-river.api
  "Authoritative programmatic API for Receipt River."
  (:require [clojure.string :as str]
            [eta-mu.receipt-river.domain.event :as event]
            [eta-mu.receipt-river.extern.bus :as bus]
            [eta-mu.receipt-river.law.receipt :as law]
            [eta-mu.receipt-river.shape.edn :as edn]))

(def package-name law/package-name)
(def package-version law/package-version)
(def schema-documents law/schema-documents)
(def schema-registry law/schemas)
(def current-schemas law/current-versions)

(defn build-event [metadata payload]
  (event/build-event metadata payload))

(defn- validate-line-in-context [line line-number context]
  (try
    (let [record (edn/parse-line line)
          original-errors (law/record-errors record)
          errors (if context (law/record-errors record context) original-errors)
          attribution (law/containing-repository-attribution record context)]
      (cond-> {:ok (empty? errors)
               :line-number line-number
               :event record
               :source/schema (if (contains? record :event/schema)
                                {:status :declared
                                 :id (get-in record [:event/schema :id])
                                 :version (get-in record [:event/schema :version])}
                                {:status :unversioned})
               :errors errors
               :line line}
        context (assoc :source/context-free-errors original-errors)
        attribution (assoc :source/repository attribution)))
    (catch :default error
      (let [message (ex-message error)]
        (bus/emit-error! :receipt-river/invalid-edn
                         {:line-number line-number
                          :exception/name "Error"
                          :exception/message message})
        (cond-> {:ok false
                 :line-number line-number
                 :event nil
                 :source/schema {:status :unreadable}
                 :errors [(str "invalid EDN: " message)]
                 :line line}
          context (assoc :source/context-free-errors
                         [(str "invalid EDN: " message)]))))))

(defn validate-line
  "Validate original bytes, optionally deriving containing-repository context.

  The public third argument is a nonblank string. Invalid attribution input
  retains context-free behavior. Results remain ClojureScript maps."
  ([line line-number]
   (validate-line-in-context line line-number nil))
  ([line line-number containing-repository-path]
   (let [context (when (and (string? containing-repository-path)
                            (not (str/blank? containing-repository-path)))
                   {:repository/path containing-repository-path})]
     (validate-line-in-context line line-number context))))
