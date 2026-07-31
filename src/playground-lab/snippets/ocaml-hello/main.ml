let rec fact n = if n <= 1 then 1 else n * fact (n - 1)

let () =
  List.iter (fun n -> Printf.printf "%d! = %d\n" n (fact n)) [ 1; 5; 10 ]
