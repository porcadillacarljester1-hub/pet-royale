import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminStore } from "@/store/adminStore";
import logo from "@/assets/PetRoyaleLogo.jpg";
import { toast } from "sonner";

const CrownIcon = ({ size = 20, color = "#f5c518" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M2 18h20M4 18L2 8l5 4 5-8 5 8 5-4-2 10H4z"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const login = useAdminStore((s) => s.login);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please fill in all fields.");
      return;
    }
    setIsLoading(true);
    const success = await login(email, password);
    setIsLoading(false);
    if (success) {
      navigate("/dashboard");
    } else {
      toast.error("Invalid credentials. Please try again.");
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600&family=Playfair+Display:wght@500;600&display=swap');

        .si-root {
          min-height: 100vh;
          display: flex;
          font-family: 'Plus Jakarta Sans', sans-serif;
          background: #f4f6fb;
        }

        .si-panel {
          width: 44%;
          background: #1a2368;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 2.75rem;
          position: relative;
          overflow: hidden;
          flex-shrink: 0;
        }
        .si-panel-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
          background-size: 48px 48px;
        }
        .si-panel-glow {
          position: absolute;
          bottom: -100px;
          left: -100px;
          width: 400px;
          height: 400px;
          border-radius: 50%;
          background: radial-gradient(circle, #f5c518 0%, transparent 60%);
          opacity: 0.06;
        }
        .si-panel-glow2 {
          position: absolute;
          top: -60px;
          right: -60px;
          width: 250px;
          height: 250px;
          border-radius: 50%;
          background: radial-gradient(circle, #f5c518 0%, transparent 60%);
          opacity: 0.04;
        }
        .si-panel-dots {
          position: absolute;
          top: 50%;
          right: -20px;
          transform: translateY(-50%);
          display: grid;
          grid-template-columns: repeat(3, 6px);
          gap: 8px;
        }
        .si-panel-dots span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255,255,255,0.07);
        }

        .si-panel-logo {
          position: relative;
          z-index: 1;
        }
        .si-panel-logo-badge {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
          padding: 9px 13px;
        }
        .si-panel-logo-text .w1 {
          display: block;
          font-family: 'Playfair Display', serif;
          font-size: 1rem;
          font-weight: 600;
          color: #f5c518;
          line-height: 1;
          letter-spacing: -0.01em;
        }
        .si-panel-logo-text .w2 {
          display: block;
          font-size: 0.58rem;
          color: rgba(255,255,255,0.4);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-top: 3px;
        }

        .si-panel-copy {
          position: relative;
          z-index: 1;
        }
        .si-panel-copy h2 {
          font-family: 'Playfair Display', serif;
          font-size: 2rem;
          font-weight: 500;
          color: #f5c518;
          line-height: 1.25;
          margin: 0 0 0.75rem;
          letter-spacing: -0.01em;
        }
        .si-panel-copy p {
          font-size: 0.8rem;
          color: rgba(255,255,255,0.38);
          line-height: 1.7;
          margin: 0;
        }
        .si-panel-copy .qt {
          font-size: 0.73rem;
          color: rgba(255,255,255,0.22);
          font-style: italic;
          margin-top: 0.5rem;
          display: block;
        }

        .si-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }
        .si-box { width: 100%; max-width: 380px; }

        .si-form-brand {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          margin-bottom: 2.25rem;
        }
        .si-form-crown-box {
          width: 40px;
          height: 40px;
          background: #1a2368;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .si-form-brand-text .s1 {
          display: block;
          font-family: 'Playfair Display', serif;
          font-size: 1rem;
          font-weight: 600;
          color: #1a2368;
          line-height: 1;
        }
        .si-form-brand-text .s2 {
          display: block;
          font-size: 0.62rem;
          letter-spacing: 0.13em;
          text-transform: uppercase;
          color: #8a97b0;
          margin-top: 3px;
        }

        .si-heading {
          font-family: 'Playfair Display', serif;
          font-size: 1.85rem;
          font-weight: 500;
          color: #1a2368;
          margin: 0 0 0.3rem;
          letter-spacing: -0.02em;
        }
        .si-subheading {
          font-size: 0.82rem;
          color: #8a97b0;
          margin: 0 0 1.85rem;
        }

        .si-field { margin-bottom: 1rem; }
        .si-field label {
          display: block;
          font-size: 0.7rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          font-weight: 600;
          color: #4a5568;
          margin-bottom: 0.4rem;
        }
        .si-input-wrap { position: relative; }
        .si-field input {
          width: 100%;
          padding: 0.68rem 0.85rem;
          border: 1.5px solid #dde3ef;
          border-radius: 8px;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 0.875rem;
          color: #1a2368;
          background: #fff;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          box-sizing: border-box;
        }
        .si-field input.has-toggle { padding-right: 2.6rem; }
        .si-field input::placeholder { color: #bcc5d8; }
        .si-field input:focus {
          border-color: #1a2368;
          box-shadow: 0 0 0 3px rgba(26,35,104,0.09);
        }
        .si-eye {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          outline: none;
          box-shadow: none;
          cursor: pointer;
          padding: 0;
          margin: 0;
          color: #9aa5be;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
          transition: color 0.15s;
        }
        .si-eye:hover { color: #1a2368; }
        .si-eye:focus { outline: none; }

        .si-sep { height: 1px; background: #e8ecf4; margin: 1.25rem 0; }

        .si-btn {
          width: 100%;
          padding: 0.75rem;
          background: #1a2368;
          color: #fff;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-size: 0.82rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }
        .si-btn:hover:not(:disabled) { background: #222d80; }
        .si-btn:active:not(:disabled) { transform: scale(0.99); }
        .si-btn:disabled { opacity: 0.55; cursor: not-allowed; }

        .si-foot {
          margin-top: 1.1rem;
          text-align: center;
          font-size: 0.8rem;
          color: #8a97b0;
        }
        .si-foot a {
          color: #1a2368;
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
        }
        .si-foot a:hover { text-decoration: underline; }

        @media (max-width: 680px) { .si-panel { display: none; } }
      `}</style>

      <div className="si-root">
        <div className="si-panel">
          <div className="si-panel-grid" />
          <div className="si-panel-glow" />
          <div className="si-panel-glow2" />
          <div className="si-panel-dots">
            {Array.from({ length: 18 }).map((_, i) => <span key={i} />)}
          </div>

          <div className="si-panel-logo">
            <div className="si-panel-logo-badge">
              <CrownIcon size={22} color="#f5c518" />
              <div className="si-panel-logo-text">
                <span className="w1">Pet Royale'</span>
                <span className="w2">Clinic &amp; Veterinary</span>
              </div>
            </div>
          </div>

          <div className="si-panel-copy">
            <h2>Where every pet is royalty.</h2>
            <p>A secure portal for Pet Royale admins and staff members.</p>
            <span className="qt">"We Care For You and Your Pets"</span>
          </div>
        </div>

        <div className="si-right">
          <div className="si-box">
            <div className="si-form-brand">
              <div className="si-form-crown-box">
                <CrownIcon size={20} color="#f5c518" />
              </div>
              <div className="si-form-brand-text">
                <span className="s1">Pet Royale'</span>
                <span className="s2">Staff Portal</span>
              </div>
            </div>

            <h1 className="si-heading">Sign in</h1>
            <p className="si-subheading">Access your account — admin or staff</p>

            <form onSubmit={handleSubmit}>
              <div className="si-field">
                <label htmlFor="si-email">Email address</label>
                <input
                  id="si-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@gmail.com"
                />
              </div>

              <div className="si-field">
                <label htmlFor="si-password">Password</label>
                <div className="si-input-wrap">
                  <input
                    id="si-password"
                    type={showPassword ? "text" : "password"}
                    className="has-toggle"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    className="si-eye"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="si-sep" />

              <button type="submit" className="si-btn" disabled={isLoading}>
                {isLoading ? "Signing in…" : "Sign In"}
              </button>
            </form>

            <p className="si-foot">
              New staff member?{" "}
              <a onClick={() => navigate("/register")}>Register here</a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
