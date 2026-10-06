const f = (t)=> t?.input_tokens ?? 0 + t?.cache_creation_input_tokens ?? 0 + t?.cache_read_input_tokens ?? 0;
for (const t of [{input_tokens:0,cache_creation_input_tokens:500,cache_read_input_tokens:9000},
                 {input_tokens:7000,cache_creation_input_tokens:500,cache_read_input_tokens:9000},
                 undefined]) {
  console.log(JSON.stringify(t), '=>', f(t));
}
const c = (u)=> u ? u?.input_tokens ?? 0 + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + u.output_tokens : 0;
console.log('compact:', c({input_tokens:0,cache_creation_input_tokens:500,cache_read_input_tokens:9000,output_tokens:300}), 'correct:', 0+500+9000+300);
