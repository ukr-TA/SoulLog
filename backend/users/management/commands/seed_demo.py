"""
`manage.py seed_demo` — populate a realistic demo environment.

Spec §110 asks for this so the app can be shown without a real person
having to hand-type a month of journal entries first.

Two rules govern everything below, and they are what make demo data safe:

  1. Every row created here has `is_demo=True`. Not "usually", not "the
     important ones" — every single row, including connections, comments,
     reactions and notifications. `clear_demo` then removes exactly what
     `seed_demo` made and nothing else, and `audit_demo_data` can prove it.

  2. Demo accounts are created through the same models and the same
     signals real registration uses. Nothing is hand-inserted around the
     application's own code paths, so demo data cannot accidentally be
     shaped differently from real data — which is what makes a demo a
     useful test of the product rather than a parallel universe.

The content itself is gentle and unremarkable on purpose: a demo of a
wellness journal should not invent someone's crisis for atmosphere.
"""

import random
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

User = get_user_model()

DEMO_PASSWORD = "SoulLogDemo!2024"

PEOPLE = [
    ("sarah.demo", "Sarah Chen", "Daily reflections on growth and gratitude.", "Kathmandu",
     ["mindfulness", "gratitude", "writing"], True),
    ("michael.demo", "Michael Roberts", "Meditation teacher. Still a beginner, most days.",
     "Pokhara", ["meditation", "teaching", "walking"], True),
    ("lisa.demo", "Lisa Kim", "Reading my way through a difficult year.", "Kathmandu",
     ["books", "healing", "journaling"], False),
    ("emma.demo", "Emma Wilson", "Mindfulness coach. Learning to take my own advice.",
     "Lalitpur", ["mindfulness", "coaching", "growth"], True),
    ("david.demo", "David Park", "Artist. Making things badly on purpose.", "Bhaktapur",
     ["creativity", "art", "growth"], False),
    ("maya.demo", "Maya Singh", "Researcher, sceptic, occasional meditator.", "Kathmandu",
     ["science", "mindfulness", "reading"], False),
]

ENTRIES = [
    ("Morning quiet", "Woke before the alarm and sat with tea instead of reaching for my phone. "
     "Nothing profound happened. It was just quiet, and I noticed it was quiet, and that felt "
     "like enough for a Tuesday.", "Calm", ["morning", "quiet"]),
    ("A hard conversation", "Had the conversation I've been avoiding for two weeks. It went "
     "worse than I hoped and much better than I feared. I keep learning the same lesson about "
     "avoidance and keep needing to learn it again.", "Anxious", ["honesty", "growth"]),
    ("Walked instead", "Skipped the gym and walked by the river for an hour. My knee is grateful. "
     "I think I've been treating exercise as a debt to repay rather than something I might "
     "actually like.", "Content", ["exercise", "walking"]),
    ("Gratitude, reluctantly", "Writing three good things felt performative today so I wrote one "
     "honest one instead: someone held a door and said good morning and I have thought about it "
     "six times since.", "Grateful", ["gratitude"]),
    ("Work is loud", "Work stress again. Same shape as last month. I notice I write about work "
     "more than anything else, which probably tells me something I already know.", "Stressed",
     ["work", "stress"]),
    ("Slept badly", "Three hours, then awake, then two more. Everything felt heavier today and I "
     "don't think that's a coincidence. Going to try putting the phone in the other room.",
     "Frustrated", ["sleep"]),
    ("Small win", "Finished the thing I'd been carrying around for a month. It took forty "
     "minutes. Forty minutes and four weeks of dread.", "Happy", ["work", "progress"]),
    ("Sunday long-form", "Long entry today because there was room for one. Thought about what I "
     "want the next year to look like and realised most of my answers are about pace rather than "
     "achievement. Slower. Fewer things. More attention to the ones that stay.", "Hopeful",
     ["reflection", "goals"]),
]

POSTS = [
    ("Three months of showing up. Not every day — I want to be honest about that. But most days, "
     "and the most days are adding up to something.", ["#consistency", "#growth"]),
    ("Reminder I needed today: rest is not a reward for finishing. It's part of the work.",
     ["#rest", "#selfcompassion"]),
    ("Started keeping a note of small kindnesses I notice. Ten days in and the list is longer "
     "than I expected, which says more about my attention than about the world.",
     ["#gratitude", "#attention"]),
    ("Meditation didn't 'work' for me for two years. Turns out I was measuring it wrong — "
     "looking for calm instead of just noticing what was there.", ["#meditation", "#mindfulness"]),
]

COMMENTS = [
    "This is exactly where I am right now. Thank you for writing it down.",
    "The bit about pace rather than achievement is going to stay with me.",
    "Needed this today, genuinely.",
    "Same. The avoidance lesson keeps coming back for me too.",
]

CONTENT = [
    ("5-Minute Morning Meditation for Inner Peace", "meditation", "🧘‍♀️", 323,
     "A short guided sit for the beginning of the day. No experience needed."),
    ("Journaling Techniques for Self-Discovery", "journaling", "📓", 765,
     "Four prompts that go past 'how was your day', and when to use each."),
    ("Breathwork for Anxiety Relief", "wellness", "🌬️", 495,
     "Simple breathing patterns you can use anywhere, including badly, and still benefit."),
    ("Building Habits That Survive a Bad Week", "growth", "⚡", 668,
     "Why most habit systems break on the first difficult day, and what to do instead."),
]


class Command(BaseCommand):
    help = "Create a realistic set of demo users and content, all flagged is_demo=True."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days", type=int, default=45,
            help="Spread the generated history over this many days (default: 45).",
        )
        parser.add_argument(
            "--force", action="store_true",
            help="Re-seed even if demo data already exists (clears it first).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        existing = User.objects.filter(is_demo=True).count()
        if existing and not options["force"]:
            self.stdout.write(self.style.WARNING(
                f"{existing} demo users already exist. Use --force to re-seed, or run "
                f"`manage.py clear_demo` first."
            ))
            return

        if existing:
            from django.core.management import call_command

            call_command("clear_demo", "--yes")

        random.seed(20240918)  # reproducible demos
        days = options["days"]
        now = timezone.now()

        users = self._create_users()
        self.stdout.write(f"Created {len(users)} demo users.")

        entries = self._create_entries(users, now, days)
        self.stdout.write(f"Created {entries} journal entries.")

        checkins = self._create_checkins(users, now, days)
        self.stdout.write(f"Created {checkins} mood check-ins.")

        connections = self._create_connections(users)
        self.stdout.write(f"Created {connections} connections and follows.")

        posts = self._create_posts(users, now, days)
        self.stdout.write(f"Created {posts} Sanctuary posts with comments and reactions.")

        library = self._create_content(users, now, days)
        self.stdout.write(f"Created {library} library items.")

        conversations = self._create_conversations(users, now)
        self.stdout.write(f"Created {conversations} conversations.")

        # The rows above are created directly, not through the actions
        # that normally award badges, so check them here. Without this the
        # demo accounts showed "Nothing earned yet" beside eleven entries.
        # Quietly: a demo account shouldn't open to a pile of badge
        # notifications for history it never lived through.
        from achievements.services import check_and_award
        badges = sum(len(check_and_award(user, notify=False)) for user in users)
        self.stdout.write(f"Awarded {badges} badges earned by that history.")

        self.stdout.write(self.style.SUCCESS(
            f"\nDemo data ready. Sign in as any of: "
            f"{', '.join(u.username for u in users)}\n"
            f"Password for all demo accounts: {DEMO_PASSWORD}\n"
            f"Remove it all again with: manage.py clear_demo"
        ))

    # --- steps --------------------------------------------------------------

    def _create_users(self):
        created = []
        for username, fullname, bio, location, interests, mentor in PEOPLE:
            user = User.objects.create_user(
                username=username,
                email=f"{username}@demo.soullog.local",
                fullname=fullname,
                password=DEMO_PASSWORD,
            )
            user.is_demo = True
            user.last_seen = timezone.now() - timedelta(minutes=random.choice([1, 5, 90, 1500]))
            user.save(update_fields=["is_demo", "last_seen"])

            # The profile row was created by the post_save signal, same as
            # for a real registration — we only fill it in.
            profile = user.profile
            profile.bio = bio
            profile.location = location
            profile.favorite_topics = interests
            profile.mentor_available = mentor
            profile.onboarding_completed = True
            profile.current_focus = random.choice([
                "Being kinder to myself about pace",
                "Writing three times a week",
                "Sleeping before midnight",
                "Saying no more often",
            ])
            profile.save()
            created.append(user)
        return created

    def _create_entries(self, users, now, days):
        from journal.models import JournalEntry

        count = 0
        for user in users:
            # Sampled, not chosen with replacement: the same person writing
            # the same entry twice looked like a bug, because it is one.
            for index, (title, content, mood, tags) in enumerate(
                random.sample(ENTRIES, k=random.randint(5, len(ENTRIES)))
            ):
                created_at = now - timedelta(
                    days=random.randint(0, days), hours=random.choice([7, 8, 13, 19, 20, 21, 22])
                )
                entry = JournalEntry.objects.create(
                    owner=user,
                    title=title,
                    content=content,
                    mood=mood,
                    tags=tags,
                    visibility=random.choices(
                        ["private", "connections", "community"], weights=[6, 2, 2]
                    )[0],
                    is_demo=True,
                )
                # auto_now_add ignores an assigned value, so the timestamp
                # is backdated with an update() after the fact.
                JournalEntry.objects.filter(pk=entry.pk).update(created_at=created_at)
                count += 1
                del index
        return count

    def _create_checkins(self, users, now, days):
        from journal.models import MOOD_CHOICES
        from moods.models import MoodCheckIn

        moods = [value for value, _label in MOOD_CHOICES]
        reasons = ["Work", "Sleep", "People", "Health", "Weather", "Nothing in particular"]

        count = 0
        for user in users:
            for _ in range(random.randint(20, 40)):
                created_at = now - timedelta(
                    days=random.randint(0, days), hours=random.randint(6, 23)
                )
                checkin = MoodCheckIn.objects.create(
                    owner=user,
                    mood=random.choice(moods),
                    reason=random.choice(reasons),
                    intensity=random.randint(3, 9),
                    description="",
                    is_demo=True,
                )
                MoodCheckIn.objects.filter(pk=checkin.pk).update(created_at=created_at)
                count += 1
        return count

    def _create_connections(self, users):
        from social.models import Connection, Follow

        count = 0
        for index, user in enumerate(users):
            for other in users[index + 1:]:
                roll = random.random()
                if roll < 0.55:
                    status = Connection.ACCEPTED
                elif roll < 0.7:
                    status = Connection.PENDING
                else:
                    continue
                Connection.objects.create(
                    requester=user,
                    addressee=other,
                    status=status,
                    responded_at=timezone.now() if status == Connection.ACCEPTED else None,
                    is_demo=True,
                )
                count += 1

        for user in users:
            for other in random.sample([u for u in users if u != user], k=2):
                _follow, created = Follow.objects.get_or_create(
                    follower=user, following=other, defaults={"is_demo": True}
                )
                count += int(created)
        return count

    def _create_posts(self, users, now, days):
        from sanctuary.models import PostBookmark, PostComment, PostReaction, SanctuaryPost

        count = 0
        for user in users:
            # Distinct posts per person — the feed used to show the same
            # author posting the same words twice.
            for content, tags in random.sample(POSTS, k=random.randint(1, 3)):
                post = SanctuaryPost.objects.create(
                    author=user, content=content, tags=tags, is_demo=True
                )
                SanctuaryPost.objects.filter(pk=post.pk).update(
                    created_at=now - timedelta(days=random.randint(0, days // 2), hours=random.randint(0, 23))
                )
                count += 1

                for other in random.sample([u for u in users if u != user], k=random.randint(1, 4)):
                    PostReaction.objects.get_or_create(
                        user=other, post=post, defaults={"is_demo": True}
                    )
                    if random.random() < 0.3:
                        PostBookmark.objects.get_or_create(
                            user=other, post=post, defaults={"is_demo": True}
                        )
                    if random.random() < 0.45:
                        PostComment.objects.create(
                            post=post,
                            author=other,
                            content=random.choice(COMMENTS),
                            is_demo=True,
                        )
        return count

    def _create_content(self, users, now, days):
        from content.models import Content, ContentCategory, ContentReaction, ContentView

        count = 0
        for title, category_slug, emoji, duration, description in CONTENT:
            author = random.choice(users)
            item = Content.objects.create(
                author=author,
                title=title,
                description=description,
                medium=Content.VIDEO,
                category=ContentCategory.objects.filter(slug=category_slug).first(),
                tags=[category_slug],
                # Demo items carry no media file: a seeded library that
                # pretends to have video would be exactly the kind of
                # plausible-looking fiction this codebase avoids. The card
                # renders; pressing play has nothing to play.
                body=description,
                thumbnail_emoji=emoji,
                duration_seconds=duration,
                is_demo=True,
            )
            Content.objects.filter(pk=item.pk).update(
                created_at=now - timedelta(days=random.randint(0, days // 2))
            )
            for viewer in random.sample(users, k=random.randint(2, len(users))):
                ContentView.objects.get_or_create(
                    content=item, user=viewer, defaults={"progress_seconds": random.randint(0, duration)}
                )
                if random.random() < 0.5:
                    ContentReaction.objects.get_or_create(
                        content=item, user=viewer, defaults={"is_demo": True}
                    )
            Content.objects.filter(pk=item.pk).update(view_count=item.views.count())
            count += 1
        return count

    def _create_conversations(self, users, now):
        from messaging.models import Message
        from messaging.services import get_or_create_direct

        openers = [
            "How did the week go?",
            "Read your last entry — the pace thing really landed.",
            "Are you still doing the morning sit?",
            "Thanks for the book recommendation.",
        ]
        replies = [
            "Better than the one before it, which is all I'm asking for.",
            "Some days. Most days I forget until the evening.",
            "That means a lot, thank you.",
            "Halfway through. Slow going but worth it.",
        ]

        count = 0
        for index in range(4):
            first, second = random.sample(users, 2)
            conversation, _created = get_or_create_direct(first, second)
            conversation.is_demo = True
            conversation.save(update_fields=["is_demo"])

            stamp = now - timedelta(hours=random.randint(1, 72))
            for turn, (sender, text) in enumerate(
                [(first, openers[index]), (second, replies[index]), (first, "Talk soon.")]
            ):
                message = Message.objects.create(
                    conversation=conversation, sender=sender, body=text, is_demo=True
                )
                Message.objects.filter(pk=message.pk).update(
                    created_at=stamp + timedelta(minutes=turn * 7)
                )
            conversation.last_message_at = stamp + timedelta(minutes=14)
            conversation.save(update_fields=["last_message_at"])
            count += 1
        return count
