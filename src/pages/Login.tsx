import { useState, type FormEvent } from "react";
import { Building2, Loader2, LockKeyhole, Mail } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const Login = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try { await login(email, password); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось войти"); }
    finally { setSubmitting(false); }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-card">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-500 text-white"><Building2 className="h-5 w-5" /></span>
          <div><h1 className="text-xl font-semibold">GUESTRA CRM</h1><p className="text-sm text-muted-foreground">Вход в систему управления продажами</p></div>
        </div>
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2"><Label htmlFor="email">Email</Label><div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="pl-9" required /></div></div>
          <div className="space-y-2"><Label htmlFor="password">Пароль</Label><div className="relative"><LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="pl-9" required /></div></div>
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}
          <Button className="w-full" type="submit" disabled={submitting}>{submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Войти</Button>
        </form>
      </div>
    </main>
  );
};

export default Login;
