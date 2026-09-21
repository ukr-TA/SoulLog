"""
`manage.py audit_demo_data` — prove that demo data is where it says it is.

This is the command that makes the other two trustworthy. It answers three
questions that matter before showing the product to anyone, and again
before a production deploy:

  1. How much demo data is in this database, and where?
  2. Is any of it *unflagged* — i.e. content owned by a demo account but
     without `is_demo=True`, which `clear_demo` would then leave behind?
  3. Are the denormalised counters (currently `Content.view_count`) still
     equal to the rows they summarise?

Exits non-zero when it finds a problem, so it can be a deployment gate
rather than something someone has to remember to read. `--fix` repairs
the two classes of problem that have a single obviously-correct repair:
missing flags, and drifted counters.
"""

from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

User = get_user_model()

# (app, model, the field naming the owning user)
OWNED_MODELS = [
    ("journal", "JournalEntry", "owner"),
    ("journal", "JournalComment", "author"),
    ("moods", "MoodCheckIn", "owner"),
    ("sanctuary", "SanctuaryPost", "author"),
    ("sanctuary", "PostComment", "author"),
    ("sanctuary", "PostReaction", "user"),
    ("sanctuary", "PostBookmark", "user"),
    ("sanctuary", "PostShare", "user"),
    ("content", "Content", "author"),
    ("content", "ContentReaction", "user"),
    ("content", "ContentSave", "user"),
    ("content", "ContentShare", "user"),
    ("content", "ContentComment", "author"),
    ("notifications", "Notification", "recipient"),
    ("messaging", "Message", "sender"),
]


class Command(BaseCommand):
    help = "Report on demo data, unflagged demo-owned rows, and counter drift."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fix", action="store_true",
            help="Set is_demo on demo-owned rows that are missing it, and recompute counters.",
        )

    def handle(self, *args, **options):
        problems = 0
        demo_user_ids = set(User.objects.filter(is_demo=True).values_list("id", flat=True))

        self.stdout.write(self.style.MIGRATE_HEADING("Demo accounts"))
        if not demo_user_ids:
            self.stdout.write("  none")
        for user in User.objects.filter(is_demo=True):
            self.stdout.write(f"  {user.username} <{user.email}>")

        self.stdout.write(self.style.MIGRATE_HEADING("\nFlagged demo rows"))
        for app_label, model_name, _owner in OWNED_MODELS:
            model = apps.get_model(app_label, model_name)
            if not hasattr(model, "is_demo"):
                continue
            count = model.objects.filter(is_demo=True).count()
            self.stdout.write(f"  {app_label}.{model_name:<20} {count}")

        self.stdout.write(self.style.MIGRATE_HEADING("\nUnflagged rows owned by demo accounts"))
        if demo_user_ids:
            for app_label, model_name, owner_field in OWNED_MODELS:
                model = apps.get_model(app_label, model_name)
                if not hasattr(model, "is_demo"):
                    continue
                stray = model.objects.filter(
                    **{f"{owner_field}_id__in": demo_user_ids}, is_demo=False
                )
                count = stray.count()
                if not count:
                    continue

                problems += 1
                self.stdout.write(self.style.WARNING(
                    f"  {app_label}.{model_name}: {count} row(s) owned by a demo account but "
                    f"not flagged — clear_demo would leave these behind"
                ))
                if options["fix"]:
                    stray.update(is_demo=True)
                    self.stdout.write(self.style.SUCCESS(f"    fixed: flagged {count} row(s)"))
                    problems -= 1
        if not problems:
            self.stdout.write("  none")

        self.stdout.write(self.style.MIGRATE_HEADING("\nCounter integrity"))
        Content = apps.get_model("content", "Content")
        drifted = 0
        for item in Content.objects.all():
            real = item.views.count()
            if real != item.view_count:
                drifted += 1
                self.stdout.write(self.style.WARNING(
                    f"  content #{item.id} view_count={item.view_count}, actual views={real}"
                ))
                if options["fix"]:
                    Content.objects.filter(pk=item.pk).update(view_count=real)
        if drifted and options["fix"]:
            self.stdout.write(self.style.SUCCESS(f"  fixed: recomputed {drifted} counter(s)"))
        elif drifted:
            problems += drifted
        else:
            self.stdout.write("  all counters match")

        self.stdout.write("")
        if problems:
            self.stdout.write(self.style.ERROR(
                f"{problems} problem(s) found. Re-run with --fix to repair."
            ))
            raise SystemExit(1)

        self.stdout.write(self.style.SUCCESS("Demo data is consistent."))
