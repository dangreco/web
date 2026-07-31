(defn sq [x] (* x x))

(println "squares:" (mapv sq (range 6)))
(reduce + (map sq (range 6)))
