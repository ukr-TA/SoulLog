"""
The five content categories the Videos tab has always shown.

They ship as a data migration rather than a fixture or a seed command
because they are not sample data — they are the chips the UI renders, and
a fresh install with none of them would have a category bar that shows
only "All Videos". `seed_demo` creates demo *content*; this creates the
shelves it goes on.

Reversible, and the reverse only removes categories nothing is filed
under, so rolling back never orphans a library item.
"""

from django.db import migrations

CATEGORIES = [
    ("meditation", "Meditation", "🧘‍♀️", 1),
    ("growth", "Personal Growth", "🌱", 2),
    ("wellness", "Wellness", "💚", 3),
    ("inspiration", "Inspiration", "✨", 4),
    ("journaling", "Journaling", "📓", 5),
]

TOPICS = [
    ("gratitude", "Gratitude", "Noticing what's already good.", "🙏"),
    ("mindfulness", "Mindfulness", "Being here for the moment you're in.", "🌊"),
    ("growth", "Growth", "The slow work of becoming.", "🌱"),
    ("healing", "Healing", "Going gently, at your own pace.", "🕊️"),
    ("creativity", "Creativity", "Making things, for their own sake.", "🎨"),
]


def seed(apps, schema_editor):
    ContentCategory = apps.get_model("content", "ContentCategory")
    for slug, label, icon, order in CATEGORIES:
        ContentCategory.objects.update_or_create(
            slug=slug, defaults={"label": label, "icon": icon, "sort_order": order}
        )

    Topic = apps.get_model("community", "Topic")
    for slug, label, description, icon in TOPICS:
        Topic.objects.update_or_create(
            slug=slug, defaults={"label": label, "description": description, "icon": icon}
        )


def unseed(apps, schema_editor):
    ContentCategory = apps.get_model("content", "ContentCategory")
    Topic = apps.get_model("community", "Topic")

    # Only remove ones nothing depends on.
    ContentCategory.objects.filter(
        slug__in=[slug for slug, *_ in CATEGORIES], content__isnull=True
    ).delete()
    Topic.objects.filter(
        slug__in=[slug for slug, *_ in TOPICS], followers__isnull=True
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("content", "0001_initial"),
        ("community", "0001_initial"),
    ]

    operations = [migrations.RunPython(seed, unseed)]
