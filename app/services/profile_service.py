"""
Profile service for handling candidate profile operations.
"""
from flask import current_app
from app.core.exceptions import APIException

class ProfileService:
    """Service class for candidate profile operations."""
    
    def __init__(self, supabase_client=None):
        """Initialize with a Supabase client."""
        if supabase_client is None:
            from flask import current_app
            supabase_client = current_app.supabase
        self.supabase = supabase_client

    def _require_supabase(self):
        """Raise a clean 503-ready error if Supabase is not configured."""
        if not self.supabase:
            raise APIException(
                "Supabase client not initialized — check SUPABASE_URL and SUPABASE_KEY",
                status_code=503
            )
    
    def get_profile(self):
        """Retrieve the candidate profile.
        Assumes there is only one profile for simplicity.
        In a real app, we would have user authentication and retrieve by user_id.
        """
        self._require_supabase()
        
        response = self.supabase.table('candidate_profiles').select('*').limit(1).execute()
        
        if response.data:
            return response.data[0]
        return None
    
    def create_profile(self, profile_data):
        """Create a new candidate profile."""
        self._require_supabase()
        
        # Ensure required fields are present
        required_fields = ['full_name', 'email']
        for field in required_fields:
            if field not in profile_data:
                raise ValueError(f"Missing required field: {field}")
        
        response = self.supabase.table('candidate_profiles').insert(profile_data).execute()
        
        if response.data:
            return response.data[0]
        return None
    
    def update_profile(self, profile_id, profile_data):
        """Update an existing candidate profile.
        If profile_id is None, update the first profile found.
        """
        self._require_supabase()
        
        # If no profile_id provided, get the first profile
        if profile_id is None:
            response = self.supabase.table('candidate_profiles').select('id').limit(1).execute()
            if not response.data:
                return None
            profile_id = response.data[0]['id']
        
        # Remove fields that shouldn't be updated
        profile_data.pop('id', None)
        profile_data.pop('created_at', None)
        
        response = self.supabase.table('candidate_profiles').update(profile_data).eq('id', profile_id).execute()
        
        if response.data:
            return response.data[0]
        return None