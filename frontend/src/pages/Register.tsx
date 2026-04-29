import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import logo from "@/assets/PetRoyaleLogo.jpg";
import { toast } from "sonner";

export default function Register() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName || !email || !password || !confirmPassword) {
      toast.error("Please fill in all fields.");
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

    // Check if email already exists
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

    // Save to staff table as pending
    const { error } = await supabase
      .from("staff" as any)
      .insert([{
        full_name: fullName,
        email: email,
        password: password,
        role: "staff",
        status: "pending"
      }]);

    setIsLoading(false);

    if (error) {
      toast.error("Registration failed. Please try again.");
      return;
    }

    toast.success("Registration submitted! Please wait for admin approval.");
    navigate("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <Card className="w-full max-w-md shadow-lg border border-gray-300">
        <CardHeader className="text-center space-y-4">
          <img src={logo} alt="Pet Royale Logo" className="h-24 mx-auto object-contain" />
          <CardTitle className="text-xl font-semibold text-black">Staff Registration</CardTitle>
          <p className="text-sm text-muted-foreground">Register and wait for admin approval</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Full Name</label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Confirm Password</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Submitting..." : "Register"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <span className="text-primary cursor-pointer hover:underline" onClick={() => navigate("/")}>
                Sign In
              </span>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}