import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { COLORS, NoteValidationError, validateConfig, validateNote, filterNotes, friendlyError } from "./core.js";

const $ = id => document.getElementById(id);
const state = { client: null, user: null, notes: [], mode: "login", editing: null, deleting: null, loading: false, saving: false, removing: false, loadVersion: 0 };
const dateFormat = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
  $("notice").hidden = !message;
}

function setMode(mode) {
  state.mode = mode;
  const signup = mode === "signup";
  $("login-tab").classList.toggle("active", !signup);
  $("signup-tab").classList.toggle("active", signup);
  $("login-tab").setAttribute("aria-pressed", String(!signup));
  $("signup-tab").setAttribute("aria-pressed", String(signup));
  $("auth-title").textContent = signup ? "Místo pro vaše nápady" : "Vítejte zpátky";
  $("auth-description").textContent = signup ? "Vytvořte si účet a začněte s čistou nástěnkou." : "Přihlaste se a navazujte tam, kde jste skončili.";
  $("auth-submit").textContent = signup ? "Vytvořit účet ↗" : "Přihlásit se ↗";
  $("password").autocomplete = signup ? "new-password" : "current-password";
  $("password").minLength = signup ? 8 : 1;
  $("password-hint").hidden = !signup;
}

function createCard(note) {
  const card = document.createElement("article");
  card.className = `note ${COLORS.includes(note.color) ? note.color : "sand"}`;
  if (note.title) {
    const title = document.createElement("h2");
    title.textContent = note.title;
    card.append(title);
  }
  const content = document.createElement("p");
  content.className = "note-content";
  // Text je vždy prostý text. Nikdy ho nevkládáme jako HTML.
  content.textContent = note.content;
  card.append(content);
  const footer = document.createElement("div");
  footer.className = "note-footer";
  const time = document.createElement("time");
  time.dateTime = note.updated_at;
  time.textContent = dateFormat.format(new Date(note.updated_at));
  time.title = "Poslední úprava";
  const actions = document.createElement("div");
  actions.className = "note-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Upravit";
  edit.setAttribute("aria-label", `Upravit poznámku: ${note.title || "bez nadpisu"}`);
  edit.addEventListener("click", () => openEditor(note));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Smazat";
  remove.setAttribute("aria-label", `Smazat poznámku: ${note.title || "bez nadpisu"}`);
  remove.addEventListener("click", () => {
    if (!state.user) return;
    state.deleting = note.id;
    $("delete-error").hidden = true;
    $("delete-dialog").showModal();
  });
  actions.append(edit, remove);
  footer.append(time, actions);
  card.append(footer);
  return card;
}

function renderNotes() {
  const visible = filterNotes(state.notes, $("search").value);
  $("notes").replaceChildren(...visible.map(createCard));
  $("note-count").textContent = `${visible.length} z ${state.notes.length} poznámek`;
  $("empty").hidden = state.loading || visible.length > 0;
  const searching = Boolean($("search").value.trim());
  $("empty-title").textContent = searching ? "Žádná poznámka neodpovídá hledání" : "Tady začíná váš další nápad";
  $("empty-description").textContent = searching ? "Zkuste jiné slovo nebo vymažte hledání." : "Přidejte první poznámku. Na všechno ostatní je čas.";
  $("empty-add").hidden = searching;
}

async function loadNotes() {
  if (!state.user) return;
  const userId = state.user.id;
  const version = ++state.loadVersion;
  state.loading = true;
  $("refresh").disabled = true;
  $("load-state").hidden = false;
  $("load-state").textContent = "Načítání poznámek…";
  $("empty").hidden = true;
  try {
    const rows = [];
    // Stránkování brání tichému oříznutí na výchozí limit Supabase.
    for (let from = 0; ; from += 200) {
      const { data, error } = await state.client.from("notes")
        .select("id,title,content,color,created_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }).order("id", { ascending: false })
        .range(from, from + 199);
      if (version !== state.loadVersion || userId !== state.user?.id) return;
      if (error) throw error;
      rows.push(...data);
      if (data.length < 200) break;
    }
    state.notes = [...new Map(rows.map(row => [row.id, row])).values()];
    state.loading = false;
    renderNotes();
    $("load-state").hidden = true;
    $("connection-state").textContent = "Data načtena · Supabase";
  } catch (error) {
    if (version !== state.loadVersion || userId !== state.user?.id) return;
    $("load-state").textContent = `${friendlyError(error)} Použijte tlačítko Obnovit.`;
    $("connection-state").textContent = "Načtení dat se nezdařilo";
  } finally {
    if (version === state.loadVersion) {
      state.loading = false;
      $("refresh").disabled = false;
    }
  }
}

async function applySession(session) {
  const previousId = state.user?.id;
  state.user = session?.user ?? null;
  const signedIn = Boolean(state.user);
  $("auth-view").hidden = signedIn;
  $("board-view").hidden = !signedIn;
  $("account").hidden = !signedIn;
  $("header-caption").hidden = signedIn;
  $("user-email").textContent = state.user?.email ?? "";
  if (previousId === state.user?.id) return;
  ++state.loadVersion; // Zahoď pozdě doběhnuté dotazy předchozího účtu.
  state.notes = [];
  state.loading = false;
  $("notes").replaceChildren();
  $("search").value = "";
  $("note-count").textContent = "";
  $("empty").hidden = true;
  $("editor").close();
  $("delete-dialog").close();
  $("note-form").reset();
  state.editing = null;
  state.deleting = null;
  notice("");
  if (signedIn) {
    $("password").value = "";
    await loadNotes();
  } else {
    $("connection-state").textContent = "Odhlášeno · poznámky jsou soukromé";
  }
}

function openEditor(note = null) {
  if (!state.user || state.saving) return;
  state.editing = note?.id ?? null;
  $("note-form").reset();
  $("note-title").value = note?.title ?? "";
  $("note-content").value = note?.content ?? "";
  const color = COLORS.includes(note?.color) ? note.color : "sand";
  document.querySelector(`input[name="color"][value="${color}"]`).checked = true;
  $("editor-title").textContent = note ? "Upravit poznámku" : "Nová poznámka";
  $("editor-error").hidden = true;
  updateCounter();
  $("editor").showModal();
  (note?.title ? $("note-title") : $("note-content")).focus();
}

function closeEditor() { if (!state.saving) $("editor").close(); }
function updateCounter() { $("char-count").textContent = `${[...$("note-content").value].length.toLocaleString("cs-CZ")} / 5 000`; }

$("login-tab").addEventListener("click", () => setMode("login"));
$("signup-tab").addEventListener("click", () => setMode("signup"));
$("search").addEventListener("input", renderNotes);
$("refresh").addEventListener("click", loadNotes);
$("add-note").addEventListener("click", () => openEditor());
$("empty-add").addEventListener("click", () => openEditor());
$("note-content").addEventListener("input", updateCounter);
$("close-editor").addEventListener("click", closeEditor);
$("cancel-editor").addEventListener("click", closeEditor);
$("editor").addEventListener("cancel", event => { if (state.saving) event.preventDefault(); });
$("cancel-delete").addEventListener("click", () => { if (!state.removing) $("delete-dialog").close(); });
$("delete-dialog").addEventListener("cancel", event => { if (state.removing) event.preventDefault(); });

$("auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.client || $("auth-fields").disabled) return;
  const mode = state.mode;
  const email = $("email").value.trim();
  const password = $("password").value;
  $("auth-fields").disabled = true;
  $("login-tab").disabled = $("signup-tab").disabled = true;
  $("auth-submit").textContent = "Chvilku strpení…";
  notice("");
  try {
    const result = mode === "signup"
      ? await state.client.auth.signUp({ email, password, options: { emailRedirectTo: new URL("./", window.location.href).href } })
      : await state.client.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    $("password").value = "";
    if (result.data.session) {
      await applySession(result.data.session);
    } else {
      notice("Pokud lze pro tento e-mail vytvořit účet, obdržíte potvrzovací zprávu. Otevřete její odkaz a potom se přihlaste. Zkontrolujte i spam.");
    }
  } catch (error) { notice(friendlyError(error), true); }
  finally {
    $("auth-fields").disabled = false;
    $("login-tab").disabled = $("signup-tab").disabled = false;
    setMode(mode);
  }
});

$("logout").addEventListener("click", async () => {
  $("logout").disabled = true;
  try {
    const { error } = await state.client.auth.signOut({ scope: "local" });
    if (error) throw error;
    await applySession(null);
    notice("Jste odhlášeni z tohoto prohlížeče.");
  } catch (error) { notice(friendlyError(error), true); }
  finally { $("logout").disabled = false; }
});

$("note-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.user || state.saving) return;
  const userId = state.user.id;
  state.saving = true;
  $("editor-error").hidden = true;
  $("note-fields").disabled = true;
  $("close-editor").disabled = true;
  $("save-note").textContent = "Ukládání…";
  try {
    const note = validateNote($("note-title").value, $("note-content").value, document.querySelector('input[name="color"]:checked').value);
    // user_id přidává databáze pomocí auth.uid(); klient jej nezadává.
    const query = state.editing
      ? state.client.from("notes").update(note).eq("id", state.editing).eq("user_id", userId)
      : state.client.from("notes").insert(note);
    const { error } = await query.select("id").single();
    if (userId !== state.user?.id) return;
    if (error) throw error;
    $("editor").close();
    notice(state.editing ? "Změny jsou uložené." : "Poznámka je uložená na nástěnce.");
    await loadNotes();
  } catch (error) {
    if (userId !== state.user?.id) return;
    $("editor-error").textContent = error instanceof NoteValidationError ? error.message : friendlyError(error);
    $("editor-error").hidden = false;
  } finally {
    state.saving = false;
    $("note-fields").disabled = false;
    $("close-editor").disabled = false;
    $("save-note").textContent = "Uložit poznámku";
  }
});

$("delete-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.user || !state.deleting || state.removing) return;
  const userId = state.user.id;
  state.removing = true;
  $("delete-fields").disabled = true;
  $("delete-error").hidden = true;
  try {
    const { error } = await state.client.from("notes").delete().eq("id", state.deleting).eq("user_id", userId).select("id").single();
    if (userId !== state.user?.id) return;
    if (error) throw error;
    $("delete-dialog").close();
    notice("Poznámka byla smazána.");
    await loadNotes();
  } catch (error) {
    if (userId !== state.user?.id) return;
    $("delete-error").textContent = friendlyError(error);
    $("delete-error").hidden = false;
  } finally {
    state.removing = false;
    $("delete-fields").disabled = false;
  }
});

window.addEventListener("offline", () => notice("Jste offline. Změny lze ukládat až po obnovení připojení.", true));
window.addEventListener("online", () => { notice("Připojení je obnoveno."); if (state.user) void loadNotes(); });

async function init() {
  const configError = validateConfig(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (configError) {
    $("setup").hidden = false;
    $("setup-text").textContent = configError;
    $("connection-state").textContent = "Nepřipojeno · doplňte konfiguraci";
    return;
  }
  try {
    // Pevná verze SDK; načítá se až s doplněnou veřejnou konfigurací.
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm");
    state.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
    });
    let authEventVersion = 0;
    state.client.auth.onAuthStateChange((_event, session) => {
      ++authEventVersion;
      // Žádné další Supabase volání uvnitř callbacku: SDK může držet auth zámek.
      setTimeout(() => { void applySession(session); }, 0);
    });
    const version = authEventVersion;
    const { data, error } = await state.client.auth.getSession();
    if (error) throw error;
    if (version === authEventVersion) await applySession(data.session);
    $("auth-fields").disabled = false;
    if (!state.user) $("connection-state").textContent = "Supabase nakonfigurováno · přihlaste se";
  } catch {
    $("setup").hidden = false;
    $("setup-text").textContent = "Připojení nelze inicializovat. Ověřte URL a veřejný klíč v config.js, připojení k internetu a dostupnost CDN. Potom obnovte stránku.";
    $("connection-state").textContent = "Inicializace se nezdařila";
  }
}

void init();
