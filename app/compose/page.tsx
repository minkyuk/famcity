import { ComposeBar } from "@/components/Compose/ComposeBar";
import Link from "next/link";

export default function ComposePage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">
          ← Back
        </Link>
        <h1 className="text-lg font-bold text-gray-800">New Post</h1>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <ComposeBar />
      </div>
    </div>
  );
}
