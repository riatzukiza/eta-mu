(ns document-history.law.storage-test
  (:require [cljs.test :refer [deftest is testing]]
            [document-history.law.storage :as storage]))

(deftest normalized-storage-path-contract-is-portable
  (testing "only a complete .ημ path component admits history storage"
    (doseq [path ["/tmp/.ημ/documents" ".ημ"]]
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

(deftest explicit-path-dialect-controls-component-boundaries
  (testing "POSIX never invents a component at a literal backslash"
    (doseq [path ["/tmp/back\\.ημ/documents" "/tmp/.ημ\\documents"]]
      (is (false? (storage/admissible-root? path :posix)))
      (is (true? (storage/admissible-root? path :windows)))))
  (testing "Windows admits backslash, slash, mixed, drive and UNC paths"
    (doseq [path ["C:\\work\\.ημ\\documents" "C:/work/.ημ/documents"
                 "C:/work\\.ημ/documents" "\\\\server\\share\\.ημ\\documents"
                 "//server/share/.ημ/documents" ".ημ"]]
      (is (true? (storage/admissible-root? path :windows)))
      (is (= path (storage/require-root! path :windows))))
    (doseq [path ["C:\\work\\document.ημ\\documents" "C:/work/.ημ-other/documents"
                 "\\\\server\\share\\.ημ-other\\documents" nil 42 ""]]
      (is (false? (storage/admissible-root? path :windows)))))
  (testing "unknown dialects fail closed rather than guessing a host"
    (doseq [dialect [nil :unknown :other]]
      (is (false? (storage/admissible-root? "/tmp/.ημ/documents" dialect)))
      (is (= :invalid-root
             (try (storage/require-root! "/tmp/.ημ/documents" dialect)
                  (catch :default cause (:document-history/error (ex-data cause)))))))))
