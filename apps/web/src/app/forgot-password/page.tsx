import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';
import { AuthLayout } from '@/components/auth-layout';

export default function Forgot() {
  return (
    <AuthLayout>
      <Suspense fallback={<p>در حال بارگذاری…</p>}>
        <AuthForm mode="forgot" />
      </Suspense>
    </AuthLayout>
  );
}
