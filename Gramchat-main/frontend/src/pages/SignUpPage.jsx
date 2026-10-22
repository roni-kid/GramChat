import { useEffect, useState } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { AtSign, Check, Eye, EyeOff, Loader2, Lock, MessageSquare, User, X } from "lucide-react";
import { axiosInstance } from "../lib/axios";
import { Link } from "react-router-dom";

import AuthImagePattern from "../components/AuthImagePattern";
import toast from "react-hot-toast";

const SignUpPage = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    username: "",
    fullName: "",
    password: "",
  });
  // null = not checked yet, otherwise { available, reason }
  const [nameCheck, setNameCheck] = useState(null);

  // live "is this username free?" while typing (debounced)
  useEffect(() => {
    const u = formData.username.trim().replace(/^@/, "");
    if (u.length < 3) { setNameCheck(null); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await axiosInstance.get("/auth/username-available", { params: { username: u } });
        setNameCheck(data);
      } catch {
        setNameCheck(null);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [formData.username]);

  const { signup, isSigningUp } = useAuthStore();

  const validateForm = () => {
    const u = formData.username.trim().replace(/^@/, "");
    if (!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(u)) return toast.error("Username: 3-20 letters, numbers or _, starting with a letter");
    if (nameCheck && nameCheck.available === false) return toast.error(nameCheck.reason || "That username is taken");
    if (!formData.password) return toast.error("Password is required");
    if (formData.password.length < 6) return toast.error("Password must be at least 6 characters");

    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const success = validateForm();

    if (success === true) signup(formData);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* left side */}
      <div className="flex flex-col justify-center items-center p-6 sm:p-12">
        <div className="w-full max-w-md space-y-8">
          {/* LOGO */}
          <div className="text-center mb-8">
            <div className="flex flex-col items-center gap-2 group">
              <div
                className="size-12 rounded-xl bg-primary/10 flex items-center justify-center 
              group-hover:bg-primary/20 transition-colors"
              >
                <MessageSquare className="size-6 text-primary" />
              </div>
              <h1 className="text-2xl font-bold mt-2">Create Account</h1>
              <p className="text-base-content/60">Get started with your free account</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Username</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <AtSign className="size-5 text-base-content/40" />
                </div>
                <input
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                  className={`input input-bordered w-full pl-10 pr-10`}
                  placeholder="your_username"
                  maxLength={21}
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                />
                {nameCheck && (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    {nameCheck.available ? <Check className="size-5 text-success" /> : <X className="size-5 text-error" />}
                  </div>
                )}
              </div>
              <p className={`text-xs mt-1 ${nameCheck && !nameCheck.available ? "text-error" : "text-base-content/50"}`}>
                {nameCheck?.available === false ? nameCheck.reason : nameCheck?.available ? "Available" : "This is how friends find you. Letters, numbers and _ (3-20)."}
              </p>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Display name <span className="text-base-content/40">(optional)</span></span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="size-5 text-base-content/40" />
                </div>
                <input
                  type="text"
                  className={`input input-bordered w-full pl-10`}
                  placeholder="John Doe"
                  maxLength={60}
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                />
              </div>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Password</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="size-5 text-base-content/40" />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  className={`input input-bordered w-full pl-10`}
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="size-5 text-base-content/40" />
                  ) : (
                    <Eye className="size-5 text-base-content/40" />
                  )}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={isSigningUp}>
              {isSigningUp ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  Loading...
                </>
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          <div className="text-center">
            <p className="text-base-content/60">
              Already have an account?{" "}
              <Link to="/login" className="link link-primary">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* right side */}

      <AuthImagePattern
        title="Join our community"
        subtitle="Connect with friends, share moments, and stay in touch with your loved ones."
      />
    </div>
  );
};
export default SignUpPage;
