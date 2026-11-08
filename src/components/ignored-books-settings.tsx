"use client";

import Link from "next/link";
import { EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Settings > Books > Ignored Books. Opens the ignored list, where books can be restored. */
export function IgnoredBooksSettings() {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EyeOff className="h-4 w-4" />
          Ignored Books
        </CardTitle>
        <CardDescription>
          Books you hid from your list. They aren&apos;t deleted, and you can restore them from there.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/ignored">Open Ignored Books</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
