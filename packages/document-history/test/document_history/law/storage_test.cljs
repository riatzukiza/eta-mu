(ns document-history.law.storage-test
  (:require [cljs.test :refer [deftest is testing]]
            [document-history.law.storage :as storage]))

(deftest normalized-storage-path-contract-is-portable
  (testing "only a complete .ημ path component admits history storage"
    (doseq [path ["/tmp/.ημ/documents" "C:\\work\\.ημ\\documents" ".ημ"]]
      (is (storage/admissible-root? path)))
    (doseq [path [nil 42 "" "/tmp/eta-mu/documents" "/tmp/.ημ-other/documents"
                 "/tmp/document.ημ/documents"]]
      (is (not (storage/admissible-root? path)))))
  (testing "the pure law refuses invalid storage without a host adapter"
    (is (= "/tmp/.ημ/documents" (storage/require-root! "/tmp/.ημ/documents")))
    (is (= :invalid-root
           (try (storage/require-root! "/tmp/outside")
                (catch :default cause (:document-history/error (ex-data cause))))))))

(deftest posix-backslash-is-not-a-component-separator
  (is (not (storage/admissible-root? "/tmp/back\\.ημ/documents")))
  (is (not (storage/admissible-root? "/tmp/.ημ\\documents")))
  (is (storage/admissible-root? "/tmp/.ημ/back\\slash/documents")))
