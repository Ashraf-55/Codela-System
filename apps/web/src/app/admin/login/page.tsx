import { LoginForm } from '@/components/Forms';
export const metadata = { title: 'Admin login' };
export default function AdminLogin() { return <main id="main" className="auth"><div className="card stack"><span className="logo">codela<i>.</i> admin</span><LoginForm platform /></div></main>; }
