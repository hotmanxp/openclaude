const f = (t,m) => t?.input_tokens ?? 0 + m?.input_tokens ?? 0;
const show = (t,m) => {
  const v = f({input_tokens:t},{input_tokens:m});
  console.log(`total=${String(t).padStart(7)} message=${String(m).padStart(7)} => ${String(v).padStart(7)}  correct=${(t??0)+(m??0)}`);
};
[7000,14000,21000,0].forEach(t=>show(t,7000));
show(undefined,7000); show(null,7000); show(undefined,undefined);
