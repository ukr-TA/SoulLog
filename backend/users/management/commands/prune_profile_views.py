"""
`manage.py prune_profile_views` — delete profile views past their
retention window.

The window is enforced on reads too, so nothing expired is ever shown
even if this hasn't run. This command is what makes the deletion real
rather than cosmetic: a row nobody displays is still a record of who
looked at whom, and keeping those forever is a liability the product
gains nothing from.

Worth running daily. In Docker that's a cron entry or a scheduled task
alongside the app.
"""

from django.core.management.base import BaseCommand

from users.models import ProfileView
from users.profile_views_service import prune


class Command(BaseCommand):
    help = "Delete profile views older than the retention window."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days", type=int, default=ProfileView.RETENTION_DAYS,
            help=f"Override the retention window (default: {ProfileView.RETENTION_DAYS}).",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Report what would be deleted without deleting it.",
        )

    def handle(self, *args, **options):
        days = options["days"]

        if options["dry_run"]:
            from django.utils import timezone

            cutoff = timezone.now() - timezone.timedelta(days=days)
            count = ProfileView.objects.filter(last_seen_at__lt=cutoff).count()
            self.stdout.write(f"Would delete {count} profile view(s) older than {days} days.")
            return

        deleted = prune(days)
        self.stdout.write(self.style.SUCCESS(
            f"Deleted {deleted} profile view(s) older than {days} days."
        ))
