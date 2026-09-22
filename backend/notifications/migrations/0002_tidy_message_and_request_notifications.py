"""
Two changes to existing rows, matching the code:

- Direct messages no longer create notifications (Whispers has its own
  unread count), so the ones already created are removed.
- Friend-request notifications now read "<name> sent you a friend
  request" / "<name> accepted your friend request"; older rows are
  reworded to match.
"""

from django.db import migrations


def forwards(apps, schema_editor):
    Notification = apps.get_model("notifications", "Notification")
    Notification.objects.filter(kind="message").delete()
    Notification.objects.filter(kind="connection_request").update(
        title="sent you a friend request", body=""
    )
    Notification.objects.filter(kind="connection_accepted").update(
        title="accepted your friend request", body=""
    )


class Migration(migrations.Migration):
    dependencies = [("notifications", "0001_initial")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
