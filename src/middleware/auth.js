export function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/login');
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.session?.user;
    if (user && roles.includes(user.role)) return next();
    return res.status(403).send('Forbidden');
  };
}
