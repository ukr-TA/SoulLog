"""
`manage.py clear_demo` — remove everything `seed_demo` created.

The safety property that matters: this command only ever deletes rows
flagged `is_demo=True`, and it never deletes a User who isn't flagged. It
asks for confirmation unless `--yes` is passed, and it prints what it is
about to remove before it removes it, because "clear the demo data" run
against the wrong environment is the kind of mistake that has no undo.

Deleting the demo *users* cascades to most of their content automatically
(every FK to User is `on_delete=CASCADE`). The explicit sweep afterwards
catches demo rows attached to real users — a demo account's comment on a
real person's post, for instance, which the cascade would also take, and
a demo reaction from a real user, which it would not.
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

User = get_user_model()

# Every model that carries an is_demo flag, swept after the user cascade.
DEMO_MODELS = [
    ("journal", "JournalEntry"),
    ("journal", "JournalComment"),
    ("moods", "MoodCheckIn"),
    ("social", "Connection"),
    ("social", "Follow"),
    ("notifications", "Notification"),
    ("messaging", "Conversation"),
    ("messaging", "Message"),
    ("sanctuary", "SanctuaryPost"),
    ("sanctuary", "PostComment"),
    ("sanctuary", "PostReaction"),
    ("sanctuary", "PostBookmark"),
    ("sanctuary", "PostShare"),
    ("content", "Content"),
    ("content", "ContentReaction"),
    ("content", "ContentSave"),
    ("content", "ContentShare"),
    ("content", "ContentComment"),
    ("community", "Topic"),
]


class Command(BaseCommand):
    help = "Delete every row flagged is_demo=True. Real user data is untouched."

    def add_arguments(self, parser):
        parser.add_argument("--yes", action="store_true", help="Skip the confirmation prompt.")

    def handle(self, *args, **options):
        from django.apps import apps

        demo_users = User.objects.filter(is_demo=True)
        user_count = demo_users.count()

        pending = []
        for app_label, model_name in DEMO_MODELS:
            model = apps.get_model(app_label, model_name)
            count = model.objects.filter(is_demo=True).count()
            if count:
                pending.append((f"{app_label}.{model_name}", count))

        if not user_count and not pending:
            self.stdout.write("No demo data found. Nothing to do.")
            return

        self.stdout.write("About to delete:")
        if user_count:
            self.stdout.write(f"  users.User                {user_count}")
        for label, count in pending:
            self.stdout.write(f"  {label:<25} {count}")

        if not options["yes"]:
            answer = input("\nProceed? [y/N] ").strip().lower()
            if answer not in ("y", "yes"):
                self.stdout.write(self.style.WARNING("Cancelled. Nothing was deleted."))
                return

        with transaction.atomic():
            # Users first: the cascade removes most of the rest.
            deleted_users, _ = demo_users.delete()

            swept = 0
            for app_label, model_name in DEMO_MODELS:
                model = apps.get_model(app_label, model_name)
                count, _detail = model.objects.filter(is_demo=True).delete()
                swept += count

        self.stdout.write(self.style.SUCCESS(
            f"Removed {deleted_users} user-owned rows and {swept} further demo rows."
        ))
