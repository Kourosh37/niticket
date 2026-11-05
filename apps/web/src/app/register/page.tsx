import { AuthLayout } from '@/components/auth-layout';
import { RegisterForm } from '@/components/register-form';

export default function Page() {
  return (
    <AuthLayout>
      <RegisterForm />
    </AuthLayout>
  );
}
