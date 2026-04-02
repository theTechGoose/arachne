const PORT = 9998;

Deno.serve({ port: PORT }, async (req) => {
  const body = await req.text();
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log("Headers:", Object.fromEntries(req.headers));
  if (body) console.log("Body:", body);

  return new Response("server error", {
    status: 500,
    headers: {
      "x-arachne-retryable": "true",
      "content-type": "text/plain",
    },
  });
});

console.log(`Retryable 500 server listening on port ${PORT}`);
