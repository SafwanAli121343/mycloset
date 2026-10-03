import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// Server-only admin client — never import this file in client components.
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// The user's age (Settings → GENDER & AGE), stored on users.age (supabase/add_user_age.sql) and
// factored into every AI style-analysis prompt — garment pros/cons, outfit analysis, wardrobe
// analysis, Preview comparisons, AI pairings — via ageSystemMessage() below. Purely additive:
// unset (or the column not migrated yet) means no extra prompt text at all, so existing
// behavior and accuracy are unchanged for anyone who hasn't entered an age.
export const MIN_AGE = 13;
export const MAX_AGE = 120;

export async function getUserAge(userId: string | null | undefined): Promise<number | null> {
  if (!userId) return null;
  try {
    const { data, error } = await adminSupabase.from("users").select("age").eq("id", userId).single();
    if (error) return null; // includes "column does not exist" before the migration is run
    const age = (data as { age?: number | null } | null)?.age;
    return typeof age === "number" && age >= MIN_AGE && age <= MAX_AGE ? age : null;
  } catch {
    return null;
  }
}

export async function setUserAge(userId: string, age: number | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await adminSupabase.from("users").update({ age }).eq("id", userId);
  if (!error) return { ok: true };
  if (error.message?.includes("age")) return { ok: false, error: "Age isn't set up on the server yet." };
  return { ok: false, error: "Something went wrong." };
}

export type Gender = "male" | "female" | "unisex";
export type UserProfile = { age: number | null; gender: Gender | null };

// Age + gender (Settings → GENDER & AGE), read together for the prompts. Each column is read
// independently so a missing one (migration not run yet) never hides the other.
export async function getUserProfile(userId: string | null | undefined): Promise<UserProfile> {
  if (!userId) return { age: null, gender: null };
  const [age, gender] = await Promise.all([getUserAge(userId), getUserGender(userId)]);
  return { age, gender };
}

export async function getUserGender(userId: string | null | undefined): Promise<Gender | null> {
  if (!userId) return null;
  try {
    const { data, error } = await adminSupabase.from("users").select("gender").eq("id", userId).single();
    if (error) return null; // includes "column does not exist" before supabase/add_user_gender.sql
    const g = (data as { gender?: string | null } | null)?.gender;
    return g === "male" || g === "female" || g === "unisex" ? g : null;
  } catch {
    return null;
  }
}

export async function setUserGender(userId: string, gender: Gender | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await adminSupabase.from("users").update({ gender }).eq("id", userId);
  if (!error) return { ok: true };
  if (error.message?.includes("gender")) return { ok: false, error: "Gender isn't set up on the server yet." };
  return { ok: false, error: "Something went wrong." };
}

const GENDER_LINE: Record<Gender, string> = {
  male: "They dress in menswear: judge fit, cuts, proportions and styling by menswear standards.",
  female: "They dress in womenswear: judge fit, cuts, proportions and styling by womenswear standards.",
  unisex: "They prefer gender-neutral dressing: judge pieces and styling by unisex/gender-neutral standards.",
};

function ageBand(age: number): string {
  if (age < 18) return "13-17";
  if (age < 25) return "18-24";
  if (age < 35) return "25-34";
  if (age < 45) return "35-44";
  if (age < 55) return "45-54";
  if (age < 65) return "55-64";
  return "65 or older";
}

// A short extra system message, added alongside a prompt's own system message. Kept separate from
// the hand-tuned prompts themselves so it can't disturb their wording; nothing is added at all
// when neither age nor gender is set.
export function profileSystemMessage(p: UserProfile): OpenAI.Chat.ChatCompletionSystemMessageParam[] {
  const parts: string[] = [];
  if (p.age != null) {
    // An age BAND, not the exact age: the judgment is the same within a band, and it lets people
    // in the same band share stored analyses of the same item (lib/aiGateway.ts caches by exact
    // request — an exact age would make nearly every request unique).
    parts.push(
      `They are ${ageBand(p.age)} years old: tailor every judgment to someone that age — whether pieces and ` +
      `outfits are age-appropriate, how current or dated a style reads for their age group, and ` +
      `the settings they're likely dressing for (e.g. school, work, nights out).`,
    );
  }
  if (p.gender) parts.push(GENDER_LINE[p.gender]);
  if (parts.length === 0) return [];
  return [{
    role: "system",
    content:
      `USER PROFILE (the person whose wardrobe this is): ${parts.join(" ")} Keep every other ` +
      `instruction and scoring standard exactly as given — this only adjusts perspective. Don't ` +
      `state their age or gender in the output.`,
  }];
}

// AI-processing consent (supabase/add_ai_consent.sql): null = not asked, true/false = answered.
// Before the column exists every read returns "allowed" so nothing breaks pre-migration.
export async function getAiConsent(userId: string | null | undefined): Promise<boolean | null> {
  if (!userId) return null;
  try {
    const { data, error } = await adminSupabase.from("users").select("ai_consent").eq("id", userId).single();
    if (error) return error.message?.includes("ai_consent") ? true : null;
    const v = (data as { ai_consent?: boolean | null } | null)?.ai_consent;
    return typeof v === "boolean" ? v : null;
  } catch {
    return null;
  }
}

export async function setAiConsent(userId: string, consent: boolean): Promise<{ ok: boolean; error?: string }> {
  const { error } = await adminSupabase.from("users").update({ ai_consent: consent }).eq("id", userId);
  if (!error) return { ok: true };
  if (error.message?.includes("ai_consent")) return { ok: false, error: "AI consent isn't set up on the server yet." };
  return { ok: false, error: "Something went wrong." };
}
