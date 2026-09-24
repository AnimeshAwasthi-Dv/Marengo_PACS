import { useState, type FormEvent, type CSSProperties } from 'react';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { api } from './lib/api';
import type { User } from './types/portal';
import marengoHospitalHero from './assets/marengo-asia-hospital-login.webp';
import marengoBrandLogo from './assets/marengo-asia-emblem.webp';
import dectrocelBrandLogo from './assets/dectrocel-brand.jpeg';
const tokenKey = 'decxpert_portal_token';
export default function LoginView({
  onLogin,
}: {
  onLogin: (token: string, user: User) => void;
}) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await api<{ token: string; user: User }>(
        "/api/auth/login",
        undefined,
        {
          method: "POST",
          body: JSON.stringify({ userId, password }),
        },
      );
      localStorage.setItem(tokenKey, result.token);
      onLogin(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main aria-label="Marengo radiology portal sign in" className="login-page balanced-login">
      <section className="login-canvas" aria-labelledby="login-heading">
        <div
          className="login-network-stage"
          style={
            {
              "--login-bg-image": `url(${marengoHospitalHero})`,
            } as CSSProperties
          }
        >
          <img
            alt="Marengo Asia Hospital"
            className="marengo-login-photo" fetchPriority="high"
            src={marengoHospitalHero}
          />
          <div className="login-stage-panel">
            <div className="login-brand-lockup">
              <div className="login-brand-mark">
                <img alt="Marengo Asia Hospitals" className="brand-logo-img" src={marengoBrandLogo} />
              </div>
              <div>
                <h1 id="login-heading">Marengo Asia Hospitals</h1>
                <p>Radiology Reporting Portal</p>
              </div>
            </div>
          </div>
        </div>

        <div className="login-auth-zone">
          <div className="login-auth-shell">
            <header className="login-form-heading">
              <div className="login-form-emblem"><img alt="Marengo Asia Hospitals" className="brand-logo-img" src={marengoBrandLogo} /></div>
              <h2>Sign in</h2>
              <p>Radiology Reporting Portal</p>
            </header>
            <form aria-busy={loading} className="login-card" onSubmit={submit}>
            <div className="login-fields">
              <label>
                User ID
                <input
                  aria-describedby={error ? "login-error" : undefined}
                  aria-invalid={Boolean(error)}
                  autoCapitalize="none"
                  autoComplete="username"
                  autoFocus
                  placeholder="Enter user ID"
                  required
                  type="text"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                />
              </label>
              <label>
                <span className="login-label-row">
                  <span>Password</span>
                  <button
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    onClick={() => setShowPassword((visible) => !visible)}
                    type="button"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </span>
                <input
                  aria-describedby={error ? "login-error" : undefined}
                  aria-invalid={Boolean(error)}
                  autoComplete="current-password"
                  placeholder="Enter password"
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <div className="login-action-row">
                <button
                  className="login-submit"
                  disabled={loading}
                  type="submit"
                >
                  {loading ? (
                    <>
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                        size={17}
                      />{" "}
                      Signing in...
                    </>
                  ) : (
                    "Sign in"
                  )}
                </button>
              </div>
              {error ? (
                <p className="login-error" id="login-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            </form>
            <footer className="login-partner">
              <span>Powered by</span>
              <img alt="Dectrocel" src={dectrocelBrandLogo} />
            </footer>
          </div>
        </div>
      </section>
    </main>
  );
}
