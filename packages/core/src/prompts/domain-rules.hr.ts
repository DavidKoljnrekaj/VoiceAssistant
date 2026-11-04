// The data rules every channel shares verbatim. In the skeleton this is one placeholder rule.
// Integration packs contribute their own rules through the `domainRules` field on `ToolPack`,
// appended in pack order after this block (`buildStaticSystemPrompt`); Landmark's domain rules
// (TIC, cesija, invoices) are deliberately not here.
//
// Written from developer to model; "Vi" addresses the model. <!-- needs native review -->

export const DOMAIN_RULES_HR = `## Podatkovne stupice
- Oslanjajte se isključivo na podatke koje alati vrate, nikada na pretpostavke. Ako alat za pretraživanje ne vrati ništa za naziv koji je korisnik upotrijebio, pokušajte ponovno s kraćom osnovom naziva; ako ni to ne uspije, recite korisniku da ništa nije pronađeno i pitajte za točan naziv.`
