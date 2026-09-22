"""
Make "default visibility for new journal entries" private, for everyone.

The setting existed (Settings → Privacy → Journal Visibility) but nothing
read it, and its stored default was "connections". It is honoured from
now on, so leaving that default in place would quietly start showing
every user's new entries to their connections. Because it has never had
any effect, no existing entry depends on its value — resetting it to
private is the only choice that keeps "private by default" true.
"""

from django.db import migrations, models


def reset_to_private(apps, schema_editor):
    UserProfile = apps.get_model("users", "UserProfile")
    UserProfile.objects.exclude(journal_visibility="private").update(journal_visibility="private")


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0004_userprofile_show_profile_views_profileview"),
    ]

    operations = [
        migrations.AlterField(
            model_name="userprofile",
            name="journal_visibility",
            field=models.CharField(
                choices=[("public", "Public"), ("connections", "Connections only"), ("private", "Private")],
                default="private",
                max_length=20,
            ),
        ),
        migrations.RunPython(reset_to_private, migrations.RunPython.noop),
    ]
