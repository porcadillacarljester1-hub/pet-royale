import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        {/* /start sends a signed-in person to their first screen, and a
            signed-out one to the login. There's no home page to return to. */}
        <Link to="/start" className="text-primary underline hover:text-primary/90">
          Back to Pet Royale
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
