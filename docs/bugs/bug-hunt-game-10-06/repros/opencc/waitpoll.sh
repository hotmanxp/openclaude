for i in $(seq 1 40); do
  a=$(python3 /tmp/bughunt-opencc/extract.py "/private/tmp/claude-501/-Users-ethan-code-opencc/77c77982-cef7-4d8a-8979-aa354512b88a/tasks/a7d484f8cab22d1f3.output" 2>/dev/null | head -1)
  b=$(python3 /tmp/bughunt-opencc/extract.py "/private/tmp/claude-501/-Users-ethan-code-opencc/77c77982-cef7-4d8a-8979-aa354512b88a/tasks/ada9b553150740340.output" 2>/dev/null | head -1)
  echo "[$i] A: ${a:0:90}"
  echo "[$i] B: ${b:0:90}"
  case "$a" in *"## Confirmed"*|*"Confirmed candidates"*) echo "A_DONE";; esac
  case "$b" in *"## Confirmed"*|*"Confirmed candidates"*) echo "B_DONE";; esac
  sleep 15
done
