import { UserProfile } from '@clerk/clerk-react';

export default function UserProfilePage() {
  return (
    <div className="flex justify-center py-6">
      <UserProfile
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "shadow-xl",
          },
        }}
      />
    </div>
  );
}
