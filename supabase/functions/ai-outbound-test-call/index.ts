// Retired 2026-11-26: this placed test calls with the Costa Rica AI agent, and every outbound
// call now goes to the US. The US test call is on Marcador IA (us-dialer, action "test").
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve((req) =>
  req.method === 'OPTIONS'
    ? new Response(null, { status: 200, headers: corsHeaders })
    : new Response(
        JSON.stringify({
          error: 'Las llamadas salientes ahora son solo a EE. UU.: use la llamada de prueba de Anna EE. UU. en Marcador IA.',
        }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
);
