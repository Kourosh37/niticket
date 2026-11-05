import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';
import { AuthLayout } from '@/components/auth-layout';

export default function Login() {
  return (
    <AuthLayout>
      <Suspense fallback={<p>در حال بارگذاری…</p>}>
        <AuthForm />
      </Suspense>
    </AuthLayout>
  );
}
