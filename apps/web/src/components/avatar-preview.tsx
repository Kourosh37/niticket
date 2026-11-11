'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Avatar } from './avatar';
import { Modal } from './ui/dialog';
import { Button } from './ui/button';

function FullAvatar({ name, image }: { name: string; image: string }) {
  const [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  return (
    <div className="avatar-preview-stage">
      {failed ? (
        <div role="alert" className="avatar-preview-error">
          <p>تصویر دریافت نشد.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            تلاش دوباره
          </Button>
        </div>
      ) : (
        <Image
          key={attempt}
          src={image}
          unoptimized
          alt={`تصویر کامل ${name}`}
          width={1024}
          height={1024}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export function AvatarPreview({
  name,
  image,
  open,
  onOpenChange,
}: {
  name: string;
  image?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!image?.startsWith('/api/v1/avatars/')) return <Avatar name={name} />;
  return (
    <>
      <button
        type="button"
        className="avatar-preview-trigger"
        aria-label={`نمایش تصویر مسئول واحد، ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
      >
        <Avatar name={name} image={image} />
      </button>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="تصویر مسئول واحد"
        description={name}
        wide
        className="avatar-preview-dialog"
      >
        {open && <FullAvatar key={image} name={name} image={image} />}
      </Modal>
    </>
  );
}
