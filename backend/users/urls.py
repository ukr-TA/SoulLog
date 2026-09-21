from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .settings_views import ChangePasswordView, DeleteAccountView, ExportDataView
from .views import (
    LoginView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RegisterView,
)

urlpatterns = [
    path("register", RegisterView.as_view(), name="auth-register"),
    path("login", LoginView.as_view(), name="auth-login"),
    path("refresh", TokenRefreshView.as_view(), name="auth-refresh"),
    path("me", MeView.as_view(), name="auth-me"),
    path("password-reset/request/", PasswordResetRequestView.as_view(), name="password-reset-request"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    path("change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("account/", DeleteAccountView.as_view(), name="delete-account"),
    path("export/", ExportDataView.as_view(), name="export-data"),
]
