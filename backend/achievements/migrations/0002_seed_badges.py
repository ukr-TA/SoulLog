"""
The starter badge catalogue.

A data migration rather than a seed command, because these aren't sample
data — they're the product's definition of what it celebrates, and a
fresh install with an empty badge table would have an achievements
section that never fills for anyone.

The set below is deliberately modest and weighted toward *doing the
thing* (writing, checking in) rather than toward social reach. A
wellbeing app that mostly rewards popularity is quietly telling people
the wrong thing about why they're here.

Note the streak ladder uses `best_streak`, not `current_streak`: a badge
for the longest run you ever managed can't be lost by having a difficult
week, which a current-streak badge effectively would be.
"""

from django.db import migrations

BADGES = [
    # slug, name, description, icon, metric, threshold, order
    ("first-entry", "First Words", "Wrote your first journal entry.", "🌱",
     "entries", 1, 1),
    ("entries-10", "Ten Entries", "Ten entries written.", "📖",
     "entries", 10, 2),
    ("entries-50", "Fifty Entries", "Fifty entries written.", "📚",
     "entries", 50, 3),
    ("entries-100", "A Hundred Entries", "One hundred entries written.", "🗂️",
     "entries", 100, 4),

    ("streak-7", "A Week Running", "Seven days in a row.", "🔥",
     "best_streak", 7, 10),
    ("streak-30", "A Month Running", "Thirty days in a row.", "🔥",
     "best_streak", 30, 11),
    ("streak-100", "A Hundred Days", "One hundred days in a row.", "🏆",
     "best_streak", 100, 12),

    ("checkins-25", "Checking In", "Twenty-five mood check-ins.", "💭",
     "mood_checkins", 25, 20),
    ("checkins-100", "Well Practised", "One hundred mood check-ins.", "🧭",
     "mood_checkins", 100, 21),

    ("first-share", "Shared Something", "Posted to the Sanctuary for the first time.", "🕊️",
     "posts", 1, 30),
    ("posts-25", "Regular Voice", "Twenty-five Sanctuary posts.", "🎙️",
     "posts", 25, 31),

    ("connections-5", "Finding People", "Five connections.", "👋",
     "connections", 5, 40),
    ("connections-25", "Well Connected", "Twenty-five connections.", "👥",
     "connections", 25, 41),

    ("reactions-50", "Resonated", "Fifty reactions received on your words.", "💛",
     "reactions_received", 50, 50),
]


def seed(apps, schema_editor):
    Badge = apps.get_model("achievements", "Badge")
    for slug, name, description, icon, metric, threshold, order in BADGES:
        Badge.objects.update_or_create(
            slug=slug,
            defaults={
                "name": name,
                "description": description,
                "icon": icon,
                "metric": metric,
                "threshold": threshold,
                "sort_order": order,
                "is_active": True,
            },
        )


def unseed(apps, schema_editor):
    Badge = apps.get_model("achievements", "Badge")
    # Only remove badges nobody has earned — rolling back a migration
    # shouldn't erase someone's record of what they did.
    Badge.objects.filter(
        slug__in=[row[0] for row in BADGES], awards__isnull=True
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("achievements", "0001_initial")]

    operations = [migrations.RunPython(seed, unseed)]
