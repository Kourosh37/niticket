import Image from 'next/image';

export function Avatar({
  name,
  image,
  small = false,
}: {
  name: string;
  image?: string | null;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${small ? 'avatar-small' : ''}`}>
      {image?.startsWith('/api/v1/avatars/') ? (
        <Image
          src={image}
          unoptimized
          alt={`تصویر ${name}`}
          width={small ? 30 : 56}
          height={small ? 30 : 56}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
        />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  );
}
