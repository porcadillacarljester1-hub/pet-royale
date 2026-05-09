import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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

const EyeIcon = ({ open }: { open: boolean }) => open ? (
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
);

export default function Register() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !email || !password || !confirmPassword) {
      toast.error("Please fill in all required fields.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    setIsLoading(true);

    const { data: existing } = await supabase
      .from("staff" as any)
      .select("id")
      .eq("email", email)
      .single();

    if (existing) {
      toast.error("Email already registered.");
      setIsLoading(false);
      return;
    }

    const { error } = await supabase
      .from("staff" as any)
      .insert([{
        full_name: fullName,
        email: email,
        password: password,
        role: "staff",
        status: "pending",
      }]);

    setIsLoading(false);

    if (error) {
      console.error("Supabase insert error:", error);
      toast.error("Registration failed. Please try again.");
      return;
    }

    toast.success("Registration submitted! Please wait for admin approval.");
    navigate("/");
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600&family=Playfair+Display:wght@500;600&display=swap');

        .rg-root {
          min-height: 100vh;
          display: flex;
          font-family: 'Plus Jakarta Sans', sans-serif;
          background: #f4f6fb;
        }

        .rg-panel {
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
        .rg-panel-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
          background-size: 48px 48px;
        }
        .rg-panel-glow {
          position: absolute;
          bottom: -100px;
          left: -100px;
          width: 400px;
          height: 400px;
          border-radius: 50%;
          background: radial-gradient(circle, #f5c518 0%, transparent 60%);
          opacity: 0.06;
        }
        .rg-panel-glow2 {
          position: absolute;
          top: -60px;
          right: -60px;
          width: 250px;
          height: 250px;
          border-radius: 50%;
          background: radial-gradient(circle, #f5c518 0%, transparent 60%);
          opacity: 0.04;
        }
        .rg-panel-dots {
          position: absolute;
          top: 50%;
          right: -20px;
          transform: translateY(-50%);
          display: grid;
          grid-template-columns: repeat(3, 6px);
          gap: 8px;
        }
        .rg-panel-dots span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: rgba(255,255,255,0.07);
        }

        .rg-panel-logo { position: relative; z-index: 1; }
        .rg-panel-logo-badge {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
          padding: 9px 13px;
        }
        .rg-panel-logo-text .w1 {
          display: block;
          font-family: 'Playfair Display', serif;
          font-size: 1rem;
          font-weight: 600;
          color: #f5c518;
          line-height: 1;
          letter-spacing: -0.01em;
        }
        .rg-panel-logo-text .w2 {
          display: block;
          font-size: 0.58rem;
          color: rgba(255,255,255,0.4);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-top: 3px;
        }

        .rg-panel-copy { position: relative; z-index: 1; }
        .rg-panel-copy h2 {
          font-family: 'Playfair Display', serif;
          font-size: 2rem;
          font-weight: 500;
          color: #f5c518;
          line-height: 1.25;
          margin: 0 0 0.75rem;
          letter-spacing: -0.01em;
        }
        .rg-panel-copy p {
          font-size: 0.8rem;
          color: rgba(255,255,255,0.38);
          line-height: 1.7;
          margin: 0;
        }
        .rg-panel-copy .qt {
          font-size: 0.73rem;
          color: rgba(255,255,255,0.22);
          font-style: italic;
          margin-top: 0.5rem;
          display: block;
        }

        .rg-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.25rem 2rem;
          overflow: hidden;
        }
        .rg-box { width: 100%; max-width: 390px; }

        .rg-form-brand {
          display: flex;
          align-items: center;
          gap: 0.7rem;
          margin-bottom: 1.1rem;
        }
        .rg-form-crown-box {
          width: 40px;
          height: 40px;
          background: #1a2368;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .rg-form-brand-text .s1 {
          display: block;
          font-family: 'Playfair Display', serif;
          font-size: 1rem;
          font-weight: 600;
          color: #1a2368;
          line-height: 1;
        }
        .rg-form-brand-text .s2 {
          display: block;
          font-size: 0.62rem;
          letter-spacing: 0.13em;
          text-transform: uppercase;
          color: #8a97b0;
          margin-top: 3px;
        }

        .rg-heading {
          font-family: 'Playfair Display', serif;
          font-size: 1.75rem;
          font-weight: 500;
          color: #1a2368;
          margin: 0 0 0.2rem;
          letter-spacing: -0.02em;
        }
        .rg-subheading { font-size: 0.82rem; color: #8a97b0; margin: 0 0 0.75rem; }

        .rg-notice {
          display: flex;
          align-items: flex-start;
          gap: 0.55rem;
          padding: 0.5rem 0.75rem;
          background: #eef1f8;
          border: 1px solid #c8d0e4;
          border-radius: 8px;
          margin-bottom: 0.85rem;
        }
        .rg-notice svg { flex-shrink: 0; margin-top: 1px; color: #1a2368; }
        .rg-notice span { font-size: 0.75rem; color: #3a4a6b; line-height: 1.5; }

        .rg-field { margin-bottom: 0.65rem; }
        .rg-field label {
          display: block;
          font-size: 0.7rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          font-weight: 600;
          color: #4a5568;
          margin-bottom: 0.4rem;
        }
        .rg-field label .opt {
          font-weight: 400;
          font-size: 0.65rem;
          color: #aab0c0;
          letter-spacing: 0.05em;
          text-transform: none;
          margin-left: 4px;
        }
        .rg-input-wrap { position: relative; }
        .rg-field input {
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
        .rg-field input.has-toggle { padding-right: 2.6rem; }
        .rg-field input::placeholder { color: #bcc5d8; }
        .rg-field input:focus {
          border-color: #1a2368;
          box-shadow: 0 0 0 3px rgba(26,35,104,0.09);
        }
        .rg-field input.match {
          border-color: #2d7a4f;
          box-shadow: 0 0 0 3px rgba(45,122,79,0.08);
        }
        .rg-field input.mismatch {
          border-color: #c0392b;
          box-shadow: 0 0 0 3px rgba(192,57,43,0.08);
        }

        .rg-eye {
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
        .rg-eye:hover { color: #1a2368; }
        .rg-eye:focus { outline: none; }

        .rg-match-hint {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-top: 5px;
          font-size: 0.71rem;
          font-weight: 500;
        }
        .rg-match-hint.ok { color: #2d7a4f; }
        .rg-match-hint.no { color: #c0392b; }

        .rg-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
        .rg-sep { height: 1px; background: #e8ecf4; margin: 0.75rem 0; }

        .rg-btn {
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
        .rg-btn:hover:not(:disabled) { background: #222d80; }
        .rg-btn:active:not(:disabled) { transform: scale(0.99); }
        .rg-btn:disabled { opacity: 0.55; cursor: not-allowed; }

        .rg-foot {
          margin-top: 0.75rem;
          text-align: center;
          font-size: 0.8rem;
          color: #8a97b0;
        }
        .rg-foot a {
          color: #1a2368;
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
        }
        .rg-foot a:hover { text-decoration: underline; }

        @media (max-width: 680px) {
          .rg-panel { display: none; }
          .rg-two-col { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="rg-root">
        <div className="rg-panel">
          <div className="rg-panel-grid" />
          <div className="rg-panel-glow" />
          <div className="rg-panel-glow2" />
          <div className="rg-panel-dots">
            {Array.from({ length: 18 }).map((_, i) => <span key={i} />)}
          </div>

          <div className="rg-panel-logo">
            <div className="rg-panel-logo-badge">
              <CrownIcon size={22} color="#f5c518" />
              <div className="rg-panel-logo-text">
                <span className="w1">Pet Royale'</span>
                <span className="w2">Clinic &amp; Veterinary</span>
              </div>
            </div>
          </div>

          <div className="rg-panel-copy">
            <h2>Where every pet is royalty.</h2>
            <p>Staff-only registration. Admin approval required before access.</p>
            <span className="qt">"We Care For You and Your Pets"</span>
          </div>
        </div>

        <div className="rg-right">
          <div className="rg-box">
            <div className="rg-form-brand">
              <div className="rg-form-crown-box">
                <CrownIcon size={20} color="#f5c518" />
              </div>
              <div className="rg-form-brand-text">
                <span className="s1">Pet Royale'</span>
                <span className="s2">Staff Portal</span>
              </div>
            </div>

            <h1 className="rg-heading">Create account</h1>
            <p className="rg-subheading">Staff registration only</p>

            <div className="rg-notice">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Your request will be reviewed by an admin before access is granted.</span>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="rg-field">
                <label htmlFor="rg-name">Full name</label>
                <input
                  id="rg-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Juan dela Cruz"
                />
              </div>

              <div className="rg-field">
                <label htmlFor="rg-email">Email address</label>
                <input
                  id="rg-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@gmail.com"
                />
              </div>

              <div className="rg-two-col">
                <div className="rg-field">
                  <label htmlFor="rg-pass">Password</label>
                  <div className="rg-input-wrap">
                    <input
                      id="rg-pass"
                      type={showPassword ? "text" : "password"}
                      className="has-toggle"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                    <button type="button" className="rg-eye" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}>
                      <EyeIcon open={showPassword} />
                    </button>
                  </div>
                </div>

                <div className="rg-field">
                  <label htmlFor="rg-confirm">Confirm</label>
                  <div className="rg-input-wrap">
                    <input
                      id="rg-confirm"
                      type={showConfirm ? "text" : "password"}
                      className={`has-toggle${passwordsMatch ? " match" : passwordsMismatch ? " mismatch" : ""}`}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                    <button type="button" className="rg-eye" onClick={() => setShowConfirm((v) => !v)} tabIndex={-1}>
                      <EyeIcon open={showConfirm} />
                    </button>
                  </div>
                  {passwordsMatch && (
                    <div className="rg-match-hint ok">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Passwords match
                    </div>
                  )}
                  {passwordsMismatch && (
                    <div className="rg-match-hint no">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      Don't match
                    </div>
                  )}
                </div>
              </div>

              <div className="rg-sep" />

              <button type="submit" className="rg-btn" disabled={isLoading}>
                {isLoading ? "Submitting…" : "Request Access"}
              </button>
            </form>

            <p className="rg-foot">
              Already have an account?{" "}
              <a onClick={() => navigate("/")}>Sign in</a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
