# Kike Sites: website sample templates for every business type

Prompt for the agent working on the Kike Sites code. The PLW side (database, agent form,
preview API) already supports these types once migration `20261119220000` has run.

---

## Task: templates for 6 new business types + full image gallery

The preview page (`/preview/plw-<token>`) renders a SavedSite returned by
`GET https://meagbbmittuhdgwnhvxa.supabase.co/functions/v1/plw-tourism-preview?token=<token>`.
Today only two templates exist, for `slug` = `plw-tourism-tours` and `plw-tourism-stays`.
PLW agents can now create samples with these slugs too:

| slug | business | main call to action |
|---|---|---|
| `plw-restaurant` | Restaurante / soda | Reservar mesa · Hacer un pedido |
| `plw-clinic` | Clínica (médica, dental, veterinaria) | Agendar una cita |
| `plw-shop` | Tienda | Consultar disponibilidad |
| `plw-gym` | Gimnasio | Agendar clase de prueba |
| `plw-real-estate` | Bienes raíces | Agendar una visita |
| `plw-auto` | Taller o agencia de autos | Agendar cita · Cotizar vehículo |

Response shape (unchanged, same for every slug):
`{ id, slug, brand: { name, city, phone, phoneHref, email, address }, content, photos,
overrides: { tourismDemo: { services[], highlight, description, facts[{label,value}],
faqs[{question,answer}], approvedImages[{url, alt, kind}] } } }`.
`overrides.tourismDemo` keeps its name for every type; don't rename it.

### Do
1. Add one template per new slug, reusing the structure and components of the existing
   tourism templates (hero with name + city, services list, about from `description` or
   `highlight`, facts, FAQs, phone call-to-action when `brand.phone` is set). Change only
   the copy, icons and call-to-action per the table. All text in Spanish.
2. Unknown or missing slug: render a generic business template instead of an error.
3. Gallery: show **all** `approvedImages` (up to 4) with their `alt` text, first one as the
   hero image. Images with `kind: "generated"` get a small "Ilustración" label.
4. Empty fields stay hidden (no "undefined", no empty sections).

### Done when
- A sample for each of the 6 slugs renders with its own call to action.
- A draft with 3 approved images shows 3 images; with none, no empty gallery.
- An unknown slug shows the generic template.
Report the files you changed and a screenshot or description per template.
