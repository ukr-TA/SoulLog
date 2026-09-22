"""
Award every badge that has already been earned but never checked.

Badges are normally checked at the moment something happens — an entry
written, a reaction received. Anything that reaches the database another
way is never checked: accounts that existed before badges were added,
demo data loaded by `seed_demo`, or rows imported in bulk. Those users
had earned badges and their profiles said "Nothing earned yet".

This walks every user once and awards what the data already supports,
without sending notifications for it. Safe to run any number of times;
a second run finds nothing to do.

    python manage.py award_badges
    python manage.py award_badges --username sarah.demo
"""

from django.core.management.base import BaseCommand

from achievements.services import check_and_award
from users.models import User


class Command(BaseCommand):
    help = "Award badges already earned by existing activity (no notifications)."

    def add_arguments(self, parser):
        parser.add_argument("--username", help="Only this user.")

    def handle(self, *args, **options):
        users = User.objects.all()
        if options.get("username"):
            users = users.filter(username=options["username"])

        total = 0
        for user in users.iterator():
            total += len(check_and_award(user, notify=False))

        self.stdout.write(self.style.SUCCESS(
            f"Awarded {total} badge{'s' if total != 1 else ''} across {users.count()} user(s)."
        ))
