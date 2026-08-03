import { createClient } from "@supabase/supabase-js";

// Server-only admin client — never import this in client components
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type User = {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
};

export async function createUser(email: string, passwordHash: string): Promise<User> {
  const { data, error } = await adminSupabase
    .from("users")
    .insert({ email: email.toLowerCase().trim(), password_hash: passwordHash })
    .select()
    .single();
  if (error) throw error;
  return data as User;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const { data, error } = await adminSupabase
    .from("users")
    .select("*")
    .eq("email", email.toLowerCase().trim())
    .single();
  if (error || !data) return null;
  return data as User;
}

export async function getUserById(id: string): Promise<User | null> {
  const { data, error } = await adminSupabase
    .from("users")
    .select("id, email, created_at")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as User;
}
