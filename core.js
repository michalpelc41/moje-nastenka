export const COLORS = ["sand", "sage", "lavender", "rose"];
export class NoteValidationError extends Error {}

export function validateConfig(url, key) {
  if (!url || !key) return "Doplňte veřejné údaje do config.js a spusťte SQL schéma podle README. Zatím se žádná data neukládají.";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) throw new Error();
  } catch { return "V config.js nastavte platné HTTPS Project URL bez cesty, parametrů a přihlašovacích údajů."; }
  if (/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key)) return "";
  try {
    const parts = key.split(".");
    if (parts.length !== 3) throw new Error();
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    if (payload.role !== "anon") throw new Error();
    return "";
  } catch { return "Použijte pouze veřejný anon nebo sb_publishable_… klíč. Privilegované a neplatné klíče aplikace odmítá."; }
}

export function validateNote(title, content, color) {
  const note = { title: title.trim(), content: content.trim(), color };
  if (!note.content) throw new NoteValidationError("Napište alespoň krátký text poznámky.");
  if ([...note.title].length > 120 || [...note.content].length > 5000) throw new NoteValidationError("Nadpis může mít nejvýše 120 a text 5 000 znaků.");
  if (!COLORS.includes(color)) throw new NoteValidationError("Vyberte jednu z nabízených barev.");
  return note;
}

export function filterNotes(notes, query) {
  const normalized = query.trim().toLocaleLowerCase("cs");
  return notes.filter(note => `${note.title}\n${note.content}`.toLocaleLowerCase("cs").includes(normalized));
}

export function friendlyError(error) {
  const code = error?.code;
  if (code === "invalid_credentials") return "E-mail nebo heslo nesouhlasí. Zkontrolujte je a zkuste to znovu.";
  if (code === "email_not_confirmed") return "Nejdřív potvrďte e-mail pomocí odkazu v potvrzovací zprávě.";
  if (["over_request_rate_limit", "over_email_send_rate_limit"].includes(code) || error?.status === 429) return "Příliš mnoho pokusů. Chvíli počkejte a zkuste to znovu.";
  if (["signup_disabled", "email_provider_disabled"].includes(code)) return "Registrace nebo přihlašování e-mailem je v Supabase vypnuté. Kontaktujte správce.";
  if (code === "weak_password") return "Heslo nesplňuje pravidla projektu. Zvolte delší a silnější heslo.";
  if (["PGRST205", "42P01", "42703"].includes(code)) return "Databáze není připravená. Spusťte supabase/schema.sql podle README.";
  if (code === "42501") return "Databáze přístup nepovolila. Ověřte přihlášení, oprávnění a RLS podle README.";
  if (code === "23514") return "Poznámka nesplňuje pravidla: text je povinný, nadpis má nejvýše 120 a text 5 000 znaků.";
  if (code === "PGRST116") return "Poznámka už není dostupná. Obnovte nástěnku a zkuste to znovu.";
  if (["session_not_found", "refresh_token_not_found", "refresh_token_already_used"].includes(code) || error?.status === 401) return "Přihlášení vypršelo. Přihlaste se prosím znovu.";
  return "Akci se nepodařilo dokončit. Zkontrolujte připojení a konfiguraci Supabase a zkuste to znovu.";
}
