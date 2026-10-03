"use client";
import { useEntitlements } from "@/contexts/EntitlementsContext";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

const FONT = { fontFamily: "Arial, sans-serif" };
// The app's theme (native/theme/theme.ts) — same colors and type scale.
const TEXT = "#111111", MUTED = "#555555", FAINT = "#8f8f8f", GOOD = "#1d9e52", BAD = "#c83030";
const TITLE: React.CSSProperties = { ...FONT, fontSize: 14, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: TEXT };
const LABEL: React.CSSProperties = { ...FONT, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: FAINT };
const BODY: React.CSSProperties = { ...FONT, fontSize: 13, color: TEXT, lineHeight: "19px", margin: 0 };
const arrowBtn: React.CSSProperties = { background: "none", border: "none", padding: 4, cursor: "pointer", display: "flex" };

// Same pages, same order, as the app's Settings.
const PAGES = ["ACCOUNT", "PLAN", "GENDER & AGE", "FEEDBACK", "LEGAL"] as const;
type Page = (typeof PAGES)[number];
// Set by the first-run tutorial (components/Tutorial.tsx) to open a page on arrival.
const TUTORIAL_PAGE_KEY = "mc_settings_page"; // also in components/Tutorial.tsx
const PREF_KEY = "mc_prefs";

type Prefs = {
  gender: "male" | "female" | "unisex" | null;
};

function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Prefs;
  } catch { return { gender: null }; }
}

function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

const GENDER_OPTIONS: { value: Prefs["gender"]; label: string; sub: string }[] = [
  { value: "male",   label: "MALE",    sub: "menswear, streetwear, men's accessories" },
  { value: "female", label: "FEMALE",  sub: "womenswear, street style, women's accessories" },
  { value: "unisex", label: "UNISEX",  sub: "gender-neutral and unisex pieces only" },
];

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<Prefs>({ gender: null });
  const [saved,  setSaved]  = useState(false);
  const [fixStatus, setFixStatus] = useState<string | null>(null);
  const [fixRunning, setFixRunning] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null);
  const [deleteRunning, setDeleteRunning] = useState(false);

  async function exportData() {
    setExportStatus("Preparing export...");
    try {
      const res = await fetch("/api/user/export");
      if (!res.ok) { setExportStatus("Export failed. Try again."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mycloset-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportStatus("Download started.");
      setTimeout(() => setExportStatus(null), 3000);
    } catch {
      setExportStatus("Export failed. Try again.");
    }
  }

  async function deleteAccount() {
    setDeleteRunning(true);
    setDeleteStatus("Deleting account...");
    try {
      const res = await fetch("/api/user/delete", { method: "DELETE" });
      if (!res.ok) { setDeleteStatus("Delete failed. Try again."); setDeleteRunning(false); return; }
      setDeleteStatus("Account deleted. Redirecting...");
      setTimeout(() => { window.location.href = "/"; }, 1500);
    } catch {
      setDeleteStatus("Delete failed. Try again.");
      setDeleteRunning(false);
    }
  }

  async function fixImages() {
    setFixRunning(true);
    setFixStatus("Scanning...");
    try {
      const res = await fetch("/api/garments/fix-images", { method: "POST" });
      const d = await res.json();
      if (!res.ok) { setFixStatus(`Error: ${d.error}`); return; }
      if (d.total === 0) {
        setFixStatus("All images are already on Supabase Storage.");
      } else {
        setFixStatus(`Fixed ${d.processed} of ${d.total} items.${d.remaining > 0 ? ` Run again for ${d.remaining} remaining.` : ""}`);
      }
    } catch (e) {
      setFixStatus(`Failed: ${String(e)}`);
    } finally {
      setFixRunning(false);
    }
  }

  useEffect(() => { setPrefs(loadPrefs()); }, []);

  // Age lives on the server (users.age) — every AI style-analysis prompt reads it (lib/userAge.ts),
  // unlike gender, which is a local display preference. Saved on blur / Enter.
  const [ageText, setAgeText] = useState("");
  const [savedAge, setSavedAge] = useState("");
  const [ageError, setAgeError] = useState("");
  useEffect(() => {
    fetch("/api/user/profile").then(r => (r.ok ? r.json() : null))
      .then((d: { age?: number | null; gender?: Prefs["gender"] } | null) => {
        const t = d?.age != null ? String(d.age) : ""; setAgeText(t); setSavedAge(t);
        // The account's saved gender wins over this browser's local copy.
        if (d?.gender) { const next = { ...loadPrefs(), gender: d.gender }; setPrefs(next); savePrefs(next); }
      })
      .catch(() => {});
  }, []);


  // Plan: redeem a key; one-time purchase balances.
  const entitlements = useEntitlements();
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null);
  async function redeem() {
    if (!redeemCode.trim() || redeeming) return;
    setRedeeming(true); setRedeemMsg(null);
    const res = await fetch("/api/billing/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: redeemCode.trim() }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) as { error?: string } : {};
    setRedeemMsg(res?.ok ? "Key redeemed." : ((d as { error?: string }).error ?? "Invalid key."));
    if (res?.ok) { setRedeemCode(""); entitlements.refresh(); }
    setRedeeming(false);
  }

  // Feedback — stored server-side (POST /api/feedback → the `feedback` table).
  const [feedback, setFeedback] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; ok: boolean } | null>(null);
  async function sendFeedback() {
    const message = feedback.trim();
    if (!message || feedbackBusy) return;
    setFeedbackBusy(true); setFeedbackMsg(null);
    const res = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, platform: "web" }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) as { error?: string } : {};
    if (res?.ok) { setFeedback(""); setFeedbackMsg({ text: "Sent! Thank you.", ok: true }); }
    else setFeedbackMsg({ text: (d as { error?: string }).error ?? "Couldn't send. Try again.", ok: false });
    setFeedbackBusy(false);
  }

  async function saveAge() {
    const t = ageText.trim();
    if (t === savedAge) return;
    setAgeError("");
    const n = t === "" ? null : Number(t);
    if (n !== null && (!Number.isInteger(n) || n < 13 || n > 120)) { setAgeError("Enter a whole number from 13 to 120."); return; }
    const res = await fetch("/api/user/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ age: n }) }).catch(() => null);
    if (!res || !res.ok) {
      const d = res ? await res.json().catch(() => ({})) : {};
      setAgeError((d as { error?: string }).error ?? "Couldn't save your age. Try again.");
      return;
    }
    setSavedAge(t);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  function setGender(g: Prefs["gender"]) {
    const next = { ...prefs, gender: g };
    setPrefs(next);
    savePrefs(next);
    // Also saved to the account — the AI analysis prompts read it (lib/userAge.ts).
    fetch("/api/user/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gender: g }) }).catch(() => {});
    // Bust the shopping rec cache so next visit re-generates with the new gender
    try {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith("mycloset_shopping"))
        .forEach(k => sessionStorage.removeItem(k));
    } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  // Account: password change — same as the app's ACCOUNT page.
  const { user, signOut, emailVerified } = useAuth();
  const [changingPw, setChangingPw] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  function resetPw() { setChangingPw(false); setPwError(""); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }
  async function submitPasswordChange() {
    if (pwBusy) return;
    setPwError("");
    if (!currentPw || !newPw) { setPwError("Fill in every field."); return; }
    if (newPw !== confirmPw) { setPwError("New passwords don't match."); return; }
    setPwBusy(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) as { error?: string } : {};
    setPwBusy(false);
    if (!res?.ok) { setPwError((d as { error?: string }).error ?? "Something went wrong."); return; }
    setPwSuccess(true);
    setCurrentPw(""); setNewPw(""); setConfirmPw("");
    setTimeout(() => { setChangingPw(false); setPwSuccess(false); }, 1500);
  }

  // Paged exactly like the app's Settings (native/screens/SettingsScreen.tsx): one section at a
  // time, ‹ PAGE › arrows to cycle. The first-run tutorial can open a page directly.
  const [pageIdx, setPageIdx] = useState(0);
  const page: Page = PAGES[pageIdx];
  function cyclePage(dir: 1 | -1) { setPageIdx(i => (i + dir + PAGES.length) % PAGES.length); }
  useEffect(() => {
    const open = (p: string) => { const i = PAGES.indexOf(p as Page); if (i >= 0) setPageIdx(i); };
    try { const pending = sessionStorage.getItem(TUTORIAL_PAGE_KEY); if (pending) { open(pending); sessionStorage.removeItem(TUTORIAL_PAGE_KEY); } } catch {}
    const onEvt = (e: Event) => open((e as CustomEvent<string>).detail);
    window.addEventListener("mc:settings-page", onEvt);
    return () => window.removeEventListener("mc:settings-page", onEvt);
  }, []);

  return (
    <main className="nav-row-host" style={{ ...FONT, minHeight: "100dvh", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", padding: "7vh 24px 10vh" }}>
      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", flex: 1 }}>
        {/* On mobile, on the nav icons' center line (.nav-row, globals.css). */}
        <p className="nav-row" style={{ ...TITLE, textAlign: "center", margin: 0 }}>SETTINGS</p>

        <div style={{ display: "flex", alignItems: "center", marginTop: 24, paddingBottom: 16 }}>
          <button aria-label="Previous page" onClick={() => cyclePage(-1)} style={arrowBtn}><Chevron dir="left" /></button>
          <p style={{ ...LABEL, flex: 1, textAlign: "center", margin: 0 }}>{page}</p>
          <button aria-label="Next page" onClick={() => cyclePage(1)} style={arrowBtn}><Chevron dir="right" /></button>
        </div>

        {/* Extra bottom padding lifts the centered body above the true middle — same nudge as the
            app's Settings (its paddingBottom), so short pages don't read as sitting low. */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "8px 0 16vh" }}>
          {page === "ACCOUNT" && (
            <div style={{ textAlign: "center" }}>
              {user?.email && <p style={{ ...BODY, marginBottom: 16 }}>{user.email}</p>}
              {!emailVerified && (
                <div style={{ marginBottom: 16 }}>
                  <p style={{ ...BODY, color: BAD, fontSize: 11, marginBottom: 4 }}>EMAIL NOT VERIFIED</p>
                  <TextBtn label="VERIFY NOW" href="/verify-email" />
                </div>
              )}
              {!changingPw ? (
                <Centered><TextBtn label="CHANGE PASSWORD" onClick={() => setChangingPw(true)} /></Centered>
              ) : (
                <div style={{ marginBottom: 16 }}>
                  <Underline hint="CURRENT" type="password" value={currentPw} onChange={setCurrentPw} />
                  <Underline hint="NEW" type="password" value={newPw} onChange={setNewPw} />
                  <Underline hint="CONFIRM" type="password" value={confirmPw} onChange={setConfirmPw} onEnter={submitPasswordChange} />
                  {pwError && <p style={{ ...BODY, color: BAD, fontSize: 11, marginBottom: 8 }}>{pwError}</p>}
                  {pwSuccess && <p style={{ ...BODY, color: GOOD, fontSize: 11, marginBottom: 8 }}>PASSWORD UPDATED</p>}
                  <div style={{ display: "flex", justifyContent: "center", gap: 24 }}>
                    <TextBtn label="CANCEL" color={FAINT} onClick={resetPw} />
                    <TextBtn label={pwBusy ? "SAVING..." : "SAVE"} onClick={submitPasswordChange} disabled={pwBusy} />
                  </div>
                </div>
              )}
              <Centered><TextBtn label={exportStatus === "Preparing export..." ? "EXPORTING..." : "EXPORT MY DATA"} onClick={exportData} /></Centered>
              {!deleteConfirm ? (
                <Centered><TextBtn label="DELETE ACCOUNT" color={BAD} onClick={() => setDeleteConfirm(true)} /></Centered>
              ) : (
                <div style={{ marginBottom: 8 }}>
                  <p style={{ ...BODY, fontSize: 12, marginBottom: 10 }}>This permanently deletes your account, closet, and all saved outfits. This can&apos;t be undone.</p>
                  <div style={{ display: "flex", justifyContent: "center", gap: 24 }}>
                    <TextBtn label="CANCEL" color={FAINT} onClick={() => setDeleteConfirm(false)} />
                    <TextBtn label={deleteRunning ? "DELETING..." : "DELETE"} color={BAD} onClick={deleteAccount} disabled={deleteRunning} />
                  </div>
                </div>
              )}
              <div style={{ minHeight: 16 }}>
                {(exportStatus || deleteStatus) && <p style={{ ...BODY, fontSize: 11, color: MUTED, margin: 0 }}>{deleteStatus ?? exportStatus}</p>}
              </div>
              {/* Web-only maintenance tool (re-hosts broken item images), kept out of the way. */}
              <div style={{ marginTop: 20 }}>
                <TextBtn label={fixRunning ? "FIXING IMAGES..." : "FIX ITEM IMAGES"} size={10} color={FAINT} onClick={fixImages} disabled={fixRunning} />
                {fixStatus && <p style={{ ...BODY, fontSize: 11, color: MUTED, margin: "6px 0 0" }}>{fixStatus}</p>}
              </div>
            </div>
          )}

          {page === "PLAN" && (
            <div data-tutorial="settings.plan" style={{ textAlign: "center" }}>
              <p style={{ ...BODY, marginBottom: 16 }}>{entitlements.tier.toUpperCase()}</p>
              <Centered><TextBtn label={entitlements.tier === "free" ? "UPGRADE" : "MANAGE PLAN"} href="/upgrade" /></Centered>
              {/* Keys can be redeemed here (the app can't take them — App Store guideline 3.1.1). */}
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 16, margin: "0 auto", maxWidth: 300 }}>
                <div style={{ flex: 1 }}>
                  <Underline hint="KEY" value={redeemCode} onChange={v => setRedeemCode(v.toUpperCase())} onEnter={redeem} noMargin />
                </div>
                <TextBtn label={redeeming ? "REDEEMING..." : "REDEEM"} onClick={redeem} disabled={!redeemCode.trim() || redeeming} />
              </div>
              {redeemMsg && <p style={{ ...BODY, fontSize: 11, color: MUTED, marginTop: 8 }}>{redeemMsg}</p>}
              <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 4 }}>
                <p style={{ ...BODY, fontSize: 12, margin: 0 }}>Single Item Analysis: {entitlements.itemScans ?? 0}</p>
                <p style={{ ...BODY, fontSize: 12, margin: 0 }}>Full Wardrobe Analysis: {entitlements.wardrobeScans ?? 0}</p>
                {((entitlements.itemScans ?? 0) > 0 || (entitlements.wardrobeScans ?? 0) > 0) && (
                  <p style={{ fontSize: 11, color: MUTED, margin: "4px 0 0", lineHeight: 1.6 }}>
                    Use a Single Item Analysis with USE SCORE? on an item in My Closet, and a Full Wardrobe Analysis from the Wardrobe page.
                  </p>
                )}
              </div>
              {/* App Store guideline 5.1.2(i) parity with the app's purchase screen. */}
              <p style={{ fontSize: 10, color: FAINT, marginTop: 16, lineHeight: 1.6 }}>
                AI features send your item photos and details (and your age range and style preference, if set) to OpenAI to
                generate analyses. By purchasing or using them you agree to this.
              </p>
            </div>
          )}

          {page === "GENDER & AGE" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 24 }}>
                {GENDER_OPTIONS.map(opt => (
                  <TextBtn key={opt.value} label={opt.label} color={prefs.gender === opt.value ? TEXT : FAINT} onClick={() => setGender(opt.value)} />
                ))}
              </div>
              {/* Saved on blur / Enter — tailors the AI analysis to the user's age. */}
              <div style={{ width: 160, margin: "24px auto 0" }}>
                <Underline hint="Age" value={ageText} inputMode="numeric" maxLength={3} error={!!ageError} noMargin
                  onChange={v => { setAgeText(v.replace(/[^0-9]/g, "").slice(0, 3)); setAgeError(""); }}
                  onBlur={saveAge} onEnter={e => e.currentTarget.blur()} />
              </div>
              {ageError && <p style={{ fontSize: 11, color: BAD, marginTop: 8 }}>{ageError}</p>}
              {saved && <p style={{ fontSize: 9, color: GOOD, letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 8 }}>SAVED</p>}
            </div>
          )}

          {page === "FEEDBACK" && (
            <div data-tutorial="settings.feedback">
              <p style={{ ...BODY, color: MUTED, textAlign: "center", marginBottom: 16 }}>You are able to send a message to our team below:</p>
              <textarea
                value={feedback}
                onChange={e => { setFeedback(e.target.value); setFeedbackMsg(null); }}
                maxLength={5000}
                placeholder="Type your message…"
                style={{ width: "100%", minHeight: 120, maxHeight: 240, border: "1px solid #ebebeb", padding: 16, fontSize: 13, lineHeight: "19px", color: TEXT, resize: "vertical", outline: "none", boxSizing: "border-box", display: "block", ...FONT }}
              />
              <div style={{ textAlign: "center", marginTop: 16 }}>
                <TextBtn label={feedbackBusy ? "SENDING..." : "SEND"} size={10} onClick={sendFeedback} disabled={!feedback.trim() || feedbackBusy} />
              </div>
              {feedbackMsg && <p style={{ fontSize: 11, color: feedbackMsg.ok ? GOOD : BAD, textAlign: "center", marginTop: 8 }}>{feedbackMsg.text}</p>}
            </div>
          )}

          {page === "LEGAL" && (
            <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 24 }}>
              <TextBtn label="TERMS" size={10} color={MUTED} href="/terms" />
              <TextBtn label="PRIVACY" size={10} color={MUTED} href="/privacy" />
              <TextBtn label="EULA" size={10} color={MUTED} href="/eula" />
              <TextBtn label="COOKIES" size={10} color={MUTED} href="/cookies" />
            </div>
          )}

          <div style={{ marginTop: 32, textAlign: "center" }}>
            <TextBtn label="SIGN OUT" size={11} color={BAD} onClick={() => { if (window.confirm("Sign out?")) signOut(); }} />
          </div>
        </div>
      </div>
    </main>
  );
}

// ── Pieces matching the app's components (TextButton, UnderlineField, type.*) ────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 8 }}>{children}</div>;
}

function TextBtn({ label, onClick, href, color = TEXT, size = 12, disabled }: {
  label: string; onClick?: () => void; href?: string; color?: string; size?: number; disabled?: boolean;
}) {
  const style: React.CSSProperties = {
    ...FONT, background: "none", border: "none", padding: "6px 0", cursor: disabled ? "default" : "pointer",
    fontSize: size, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
    color, opacity: disabled ? 0.4 : 1, textDecoration: "none", display: "inline-block",
  };
  if (href) return <Link href={href} style={style}>{label}</Link>;
  return <button onClick={onClick} disabled={disabled} style={style}>{label}</button>;
}

function Underline({ hint, value, onChange, onBlur, onEnter, type = "text", inputMode, maxLength, error, noMargin }: {
  hint: string; value: string; onChange: (v: string) => void; onBlur?: () => void;
  onEnter?: (e: React.KeyboardEvent<HTMLInputElement>) => void; type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; maxLength?: number; error?: boolean; noMargin?: boolean;
}) {
  return (
    <div style={{ position: "relative", borderBottom: `1px solid ${error ? BAD : "#d8d8d8"}`, marginBottom: noMargin ? 0 : 8 }}>
      <input
        value={value} type={type} inputMode={inputMode} maxLength={maxLength}
        onChange={e => onChange(e.target.value)} onBlur={onBlur}
        onKeyDown={e => { if (e.key === "Enter") onEnter?.(e); }}
        style={{ ...FONT, width: "100%", border: "none", padding: "8px 70px 8px 0", fontSize: 13, outline: "none", background: "transparent", boxSizing: "border-box", color: TEXT }}
      />
      <span style={{ ...FONT, position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: FAINT, pointerEvents: "none" }}>{hint}</span>
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {dir === "left" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  );
}
